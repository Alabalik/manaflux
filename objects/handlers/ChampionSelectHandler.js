const rp = require('request-promise-native');
const { captureException } = require('@sentry/electron');

const ItemSetHandler = require('./ItemSetHandler');
const ProviderHandler = new (require('./ProviderHandler'))();

class ChampionSelectHandler {
  constructor() {
    this.gameModes = {
      CLASSIC: new (require('../gameModes/CLASSIC'))(this, ProviderHandler)
    }
  }

  load() {
    const self = this;
    this._checkTimer = setInterval(function() {
      self.getSession().then(x => self.onTickEvent(x.body)).catch(err => {
        if (err.statusCode === 404) {
          if (self.inChampionSelect) return self.end();
        }
        else UI.error(err);
      });
    }, 1000);
  }

  async getSession() {
    return await rp({
      method: 'GET',
      uri: Mana.base + 'lol-champ-select/v1/session',
      resolveWithFullResponse: true,
      json: true
    });
  }

  async onTickEvent(data) {
    if (!this.inChampionSelect) {
      await this.onFirstTickEvent(data);
      this.inChampionSelect = true;
    }

    this.gameModes[this.gameMode].onTickEvent(data);

    if (this._lastChampionId === this.gameModes[this.gameMode].getPlayer().championId) return;
    if ((this._lastChampionId = this.gameModes[this.gameMode].getPlayer().championId) === 0) return UI.status('ChampionSelect', 'champion-select-pick');

    const champion = Mana.champions[this.gameModes[this.gameMode].getPlayer().championId];

    /* Delete ItemSets before downloading */
    await ItemSetHandler.deleteItemSets(await ItemSetHandler.getItemSetsByChampionKey(champion.key));

    this.gameModes[this.gameMode].onChampionChangeEvent(champion);
    this.updateDisplay(champion, ProviderHandler.createDownloadEventEmitter(champion, this.gameMode, this.gameModes[this.gameMode].getPosition()));
  }

  async onFirstTickEvent(data) {
    ipcRenderer.send('champion-select-in');
    log.dir(3, data);

    this.gameMode = await Mana.user.getGameMode();
    this.gameModes[this.gameMode].onFirstTickEvent(data);
  }

  updateDisplay(champion, dl) {
    UI.status('ChampionSelect', 'champion-updating-display', champion.name);

    const onPerkPositionChange = this.onPerkPositionChange;
    let first = false;

    dl.on('summonerspells', (provider, pos, data) => {
      console.dir(arguments);
      if (Mana.store.get('enableSummonerSpells'))
        $('button#loadSummonerSpells').enableManualButton(() => Mana.user.updateSummonerSpells(data).catch(err => { UI.error(err); captureException(err); }), true);
    }).on('perksPage', (provider, pos, data) => {
      $('#positions')
      .append(`<option value="${pos}">${pos === 'ADC' ? 'ADC' : pos.charAt(0).toUpperCase() + pos.slice(1)}</option>`)
      .change(function() {
        if (this.value === pos) onPerkPositionChange(champion, this.value, data);
      });

      if (!first) {
        first = true;
        $('#positions').val(log.log(3, pos)).trigger('change').show();
      }
    }).on('itemset', (provider, pos, itemset) => {
      if (!Mana.store.get('enableItemSets')) return;
      itemset.save().catch(err => UI.error(err));
    });

    UI.tray(false);
  }

  async onPerkPositionChange(champion, position, perks) {
    console.dir(perks);

    /* Perks display */
    if (Mana.store.get('enableAnimations'))
      UI.enableHextechAnimation(champion, perks[0].primaryStyleId);
      /* TODO: Change hextech animation according to active rune page change */

    if (Mana.store.get('loadRunesAutomatically')) {
      Mana.user.getPerksInventory().updatePerksPages(data.runes)
      .catch(err => {
        UI.error(err);
        captureException(err);
      });
    }
    else {
      $('button#loadRunes').enableManualButton(() => Mana.user.getPerksInventory().updatePerksPages(data.runes)
        .catch(err => {
          UI.error(err);
          captureException(err);
        }), true);
    }

    UI.status('ChampionSelect', 'runes-loaded', champion.name, position);
  }

  destroyDisplay() {
    UI.status('ChampionSelect', 'champion-select-waiting');
    UI.disableHextechAnimation();

    $('#positions').unbind().empty().hide();
    $('button#loadRunes, button#loadSummonerSpells').disableManualButton();

    ipcRenderer.removeAllListeners('runes-previous');
    ipcRenderer.removeAllListeners('runes-next');

    if (Mana.store.get('enableTrayIcon')) UI.tray();
  }

  end() {
    this.inChampionSelect = false;

    ipcRenderer.send('champion-select-out');
    ipcRenderer.removeAllListeners('runes-previous');
    ipcRenderer.removeAllListeners('runes-next');

    this.gameModes[this.gameMode].end();

    Mana.user.getPerksInventory()._pageCount = null;
    Mana.user.getPerksInventory()._perks = null;

    this.destroyDisplay();
    return this;
  }

  stop() {
    clearInterval(this._checkTimer);
  }
}


/* Shortcuts handling
ipcRenderer.on('runes-previous', () => {
  log.log(2, '[Shortcuts] Selecting previous position..');

  const keys = Object.keys(data);
  let i = keys.length, positionIndex = keys.indexOf($('#positions').val());
  let newIndex = positionIndex;

  if (newIndex === 0) newIndex = i - 1;
  else newIndex--;

  /* Useless to change position if it's already the one chosen
  if (newIndex !== positionIndex) $('#positions').val(keys[newIndex]).trigger('change');
});

ipcRenderer.on('runes-next', () => {
  log.log(2, '[Shortcuts] Selecting next position..');

  const keys = Object.keys(data);
  let i = keys.length, positionIndex = keys.indexOf($('#positions').val());
  let newIndex = positionIndex;

  if (newIndex === i - 1) newIndex = 0;
  else newIndex++;

  /* Useless to change position if it's already the one chosen
  if (newIndex !== positionIndex) $('#positions').val(keys[newIndex]).trigger('change');
});*/

module.exports = ChampionSelectHandler;
