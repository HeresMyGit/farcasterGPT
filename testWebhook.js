// testWebhook.js

// Load environment variables
require('dotenv').config();

// Import the handleWebhook function from assistant.js
const { handleWebhook } = require('./assistant');

// Your test webhook data
const testWebhookData = {
  "created_at": 1726442095,
  "type": "cast.created",
  "data": {
    "object": "cast",
    "hash": "0xc293c32e8c1abfd2d72ce56001de955b46465103",
    "thread_hash": "0xc293c32e8c1abfd2d72ce56001de955b46465103",
    "parent_hash": null,
    "parent_url": null,
    "root_parent_url": null,
    "parent_author": {
      "fid": null
    },
    "author": {
      "object": "user",
      "fid": 242188,
      "custody_address": "0xbf6eec57d75d0f989df12a7b5ee4f695683fec38",
      "username": "heresmy",
      "display_name": "heresmy.eth",
      "pfp_url": "https://i.imgur.com/q6U4kbp.gif",
      "profile": {
        "bio": {
          "text": "I make mfer products and software like @mfergpt"
        }
      },
      "follower_count": 1717,
      "following_count": 499,
      "verifications": [
        "0x0a8138c495cd47367e635b94feb7612a230221a4"
      ],
      "verified_addresses": {
        "eth_addresses": [
          "0x0a8138c495cd47367e635b94feb7612a230221a4"
        ],
        "sol_addresses": []
      },
      "active_status": "inactive",
      "power_badge": false
    },
    "text": "@mfergpt give me new data on @kevinmfer.",
    "timestamp": "2024-09-15T23:14:56.000Z",
    "embeds": [],
    "reactions": {
      "likes_count": 0,
      "recasts_count": 0,
      "likes": [],
      "recasts": []
    },
    "replies": {
      "count": 0
    },
    "channel": null,
    "mentioned_profiles": [
      {
        "object": "user",
        "fid": 853707,
        "custody_address": "0x340705619608776661031e2acf15e74dd542cb1f",
        "username": "mfergpt",
        "display_name": "mferGPT",
        "pfp_url": "https://imagedelivery.net/BXluQx4ige9GuW0Ia56BHw/0047fc80-64b5-4b08-bed3-837526dd6100/rectcrop3",
        "profile": {
          "bio": {
            "text": "by @heresmy",
            "mentioned_profiles": []
          }
        },
        "follower_count": 144,
        "following_count": 1,
        "verifications": [
          "0x3b54621fe962ee8e5283f2429b800e2e212c9a02"
        ],
        "verified_addresses": {
          "eth_addresses": [
            "0x3b54621fe962ee8e5283f2429b800e2e212c9a02"
          ],
          "sol_addresses": []
        },
        "active_status": "inactive",
        "power_badge": false
      }
    ],
    "event_timestamp": "2024-09-15T23:14:55.916Z"
  }
}


// Create mock request (req) and response (res) objects
const req = {
  body: testWebhookData
};

// Mock response object with status and send methods
const res = {
  status: (code) => {
    return {
      send: (message) => {
        console.log(`Status: ${code}, Message: ${message}`);
      }
    };
  },
  send: (message) => {
    console.log(`Message: ${message}`);
  }
};

// Call the handleWebhook function with the mock req and res
handleWebhook(req, res);
