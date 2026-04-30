module.exports = {
  presets: [
    [
      '@babel/preset-env',
      {
        targets: {
          browsers: ["IE 11"],
        },
        useBuiltIns: 'usage',
        corejs: 3
      },
    ],
  ],
  plugins: [
    '@babel/plugin-proposal-export-default-from',
  ],
};
