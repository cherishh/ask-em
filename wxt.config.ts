import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: "ask'em",
    description: 'Sync prompts across AI chat providers',
    version: '0.1.0',
    permissions: ['storage', 'tabs'],
    optional_host_permissions: ['https://*/*'],
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
  },
});
