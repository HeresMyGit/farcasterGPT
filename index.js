// index.js

require('dotenv').config();
require('./webhook');

setInterval(() => {
    const now = new Date();
    console.log(`${now.toLocaleString()}: UP`);
}, 5000);