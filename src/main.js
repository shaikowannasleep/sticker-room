import './style.css';
import { loadJolt } from './physics.js';
import { Game } from './game.js';

const loadingTxt = document.getElementById('loading-txt');

async function boot() {
  try {
    loadingTxt.textContent = 'Warming up physics…';
    await loadJolt();
    loadingTxt.textContent = 'Unpacking stickers…';
    const game = new Game(document.getElementById('c'));
    window.__game = game;
    await game.init();
    document.getElementById('loading').classList.add('hidden');
    game.showMenu();
  } catch (e) {
    console.error(e);
    loadingTxt.textContent = 'Oops! Could not start: ' + (e && e.message ? e.message : e);
  }
}
boot();
