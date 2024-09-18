const { openai, neynarClient } = require('./client');
const axios = require('axios');

async function generateImage(prompt) {
  try {
    console.log('Image generation requested.');

    // Step 3: Generate the image using the prompt
    const imageResponse = await openai.images.generate({
      prompt: prompt,
      n: 1,
      size: "1024x1024",
      model: "dall-e-3",
      response_format: "b64_json", // Get the image data in base64 format
    });

    const imageBase64 = imageResponse.data[0].b64_json;

    // Step 4: Upload the image to FreeImage.host
    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('key', process.env.FREEIMAGE_API_KEY); // Your API key for FreeImage.host
    formData.append('action', 'upload');
    formData.append('source', imageBase64);
    formData.append('format', 'json');

    const uploadResponse = await axios.post('https://freeimage.host/api/1/upload', formData, {
      headers: formData.getHeaders(),
    });

    // Extract the image URL from the response
    // const imageUrl = uploadResponse.data.image.url.full;
    const imageUrl = uploadResponse.data.image.url; // Full-size image
    console.log(`Image generated and uploaded. URL: ${imageUrl}`);

    return imageUrl;
  } catch (error) {
    console.error('Error generating image:', error);
    return null;
  }
}

module.exports = {
  generateImage
}