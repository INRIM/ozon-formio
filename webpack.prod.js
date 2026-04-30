const path = require('path');
const webpack = require('webpack');
const packageJSON = require('./package.json');
module.exports = {
    mode: 'production',
    entry: './src/renderer.js',
    output: {
        library: 'Formio',
        libraryTarget: 'umd2',
        libraryExport: 'Formio',
        path: path.resolve(__dirname, 'dist/lib/formiojs'),
        filename: 'formio.form.min.js',
        environment: {
            arrowFunction: false
        },
    },
    optimization: {
        minimize: true
    },
    plugins: [
        new webpack.DefinePlugin({
            FORMIO_VERSION: `'${packageJSON.version}'`
        }),
        new webpack.IgnorePlugin({
            resourceRegExp: /^\.\/locale$/,
            contextRegExp: /moment$/
        }),
    ],
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader'
                }
            }
        ]
    }
};
