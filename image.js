const { openai, neynarClient } = require('./client');
const axios = require('axios');
const { saveImageLog, loadImageLog } = require('./threadUtils');

async function generateImage(prompt) {
  try {
    console.log('Image generation requested.');

    // Generate the image using the prompt
    const imageResponse = await openai.images.generate({
      prompt: prompt,
      n: 1,
      size: "1024x1024",
      model: "dall-e-3",
      response_format: "b64_json",
    });

    const imageBase64 = imageResponse.data[0].b64_json;

    // Upload the image to FreeImage.host
    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('key', process.env.FREEIMAGE_API_KEY);
    formData.append('action', 'upload');
    formData.append('source', imageBase64);
    formData.append('format', 'json');

    const uploadResponse = await axios.post('https://freeimage.host/api/1/upload', formData, {
      headers: formData.getHeaders(),
    });

    const imageUrl = uploadResponse.data.image.url;
    console.log(`Image generated and uploaded. URL: ${imageUrl}`);

    // Log the image URL with the timestamp
    const logEntry = { timestamp: new Date().toISOString(), url: imageUrl };
    saveImageLog(logEntry);

    return imageUrl;
  } catch (error) {
    console.error('Error generating image:', error);
    return null;
  }
}

// Check if a URL is valid (i.e., exists in the log)
function urlIsValid(url) {
  const imageLog = loadImageLog();
  return imageLog.some(entry => entry.url === url);
}

module.exports = {
  generateImage,
  urlIsValid
};