// index.js

require('dotenv').config();
require('./webhook');

setInterval(() => {
    const now = new Date();
    console.log(`${now.toLocaleString()}: MF-GPT APP-IS-UP`);
}, 5000);