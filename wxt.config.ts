import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: "ask'em",
    description: 'Sync prompts across AI chat providers',
    version: '0.1.0',
    permissions: ['storage', 'tabs'],
  },
});
