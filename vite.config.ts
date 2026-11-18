import { defineConfig } from 'vite';

// base 用相對路徑：CrazyGames / Poki 會把遊戲放在子路徑下。
export default defineConfig({
  base: './',
  build: { target: 'es2020' },
});
