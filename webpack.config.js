const path = require('path');

module.exports = {
    mode: 'production', // Set to 'development' for debugging
    entry: './index.js', // The entry point for your application
    output: {
        filename: 'bundle.js', // Output filename
        path: path.resolve(__dirname, 'dist'), // Output directory
        libraryTarget: 'umd', // Export as a UMD module
    },
    target: 'node', // Specify that this is a Node.js application
    resolve: {
        extensions: ['.js'], // Resolve these extensions
    },
    module: {
        rules: [
            {
                test: /\.js$/, // Apply the rule to .js files
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader', // Use Babel to transpile ES6+
                    options: {
                        presets: ['@babel/preset-env'],
                    },
                },
            },
        ],
    },
};
