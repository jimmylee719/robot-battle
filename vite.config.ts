import { defineConfig } from 'vite';
import { devLeague } from './server/devLeague';

// base 用相對路徑：CrazyGames / Poki 會把遊戲放在子路徑下。
// devLeague：開發時的聯盟伺服器（非同步對戰），只在 `npm run dev` 有，不會打包進遊戲。
export default defineConfig({
  base: './',
  build: { target: 'es2020' },
  plugins: [devLeague()],
});
