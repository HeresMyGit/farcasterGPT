const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');
const cheerio = require('cheerio'); 
const { neynarClient, openai } = require('./client'); // Importing the client details

// Function to check content type of the URL
async function getContentType(url) {
  console.log(`Function called: getContentType(${url})`);
  try {
    const response = await axios.head(url);
    if (!response.headers['content-type']) {
      console.log(`Content type is undefined, treating as website.`);
      return null;  // Return null to indicate undefined content type (website)
    }
    return {
      contentType: response.headers['content-type'],
      contentLength: response.headers['content-length'],
      url: url,
      filename: path.basename(url)
    };
  } catch (error) {
    console.error(`Failed to fetch the URL content type: ${error.message}`);
    return null;  // Return null if the content type retrieval fails
  }
}

// Function to fetch website text content
async function fetchWebsiteText(url) {
  console.log(`Function called: fetchWebsiteText(${url})`);
  try {
    const response = await axios.get(url);
    const html = response.data;

    // Clean up the HTML using Cheerio
    const cleanedText = cleanHTML(html);

    // Ensure the text stays within the size limit (80% of 1 MB)
    const byteSize = Buffer.byteLength(cleanedText, 'utf8');
    if (byteSize > 838860) {
      const trimmedText = cleanedText.substring(0, Math.floor(838860 * 0.8));  // Trim to 80% of the target size
      return trimmedText;
    }
    return cleanedText;
  } catch (error) {
    return `Error fetching website content: ${error.message}`;
  }
}

// Function to clean HTML using Cheerio
function cleanHTML(html) {
  console.log('Function called: cleanHTML');
  
  const $ = cheerio.load(html);

  // Remove unnecessary tags like <script>, <style>, and <noscript>
  $('script, style, noscript, iframe, link, meta, header, footer, nav').remove();

  // Remove comments
  $('*').contents().each(function () {
    if (this.type === 'comment') $(this).remove();
  });

  // Extract main content, using common tags for articles
  let cleanedText = '';
  
  const contentSelectors = [
    'article',          // Typical article tag
    'main',             // Main content
    'div#content',      // WordPress-style content div
    'div[class*="content"]',  // Other potential content divs
    'div.post',         // Blog post content
    'p',                // Paragraphs
    'h1, h2, h3, h4',   // Headers
    'li'                // List items
  ];

  contentSelectors.forEach(selector => {
    $(selector).each((i, elem) => {
      cleanedText += $(elem).text() + '\n';
    });
  });

  // Return the clean, concatenated text
  return cleanedText.trim();
}

// Function to send website data to OpenAI for detailed analysis
async function interpretWebsite(websiteText, prompt) {
  console.log(`Function called: interpretWebsite`);
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",  // Use the appropriate model version you're working with
      messages: [
        {
          role: "user",
          content: `Please provide an extremely detailed analysis of the following website content. ${prompt}\n\n${websiteText}`
        },
      ],
    });
    console.log(response.choices[0].message.content);  // Log the result
    return response.choices[0].message.content;
  } catch (error) {
    return `Error interpreting website: ${error.message}`;
  }
}

// Function to interact with OpenAI for image URL interpretation
async function interpretImage(imageUrl, prompt) {
  console.log(`Function called: interpretImage(${imageUrl})`);
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",  // Use the appropriate model version you're working with
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `${prompt}` },
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
              },
            },
          ],
        },
      ],
    });
    console.log(response.choices[0].message.content);  // Log the result
    return response.choices[0].message.content;
  } catch (error) {
    return `Error interpreting image: ${error.message}`;
  }
}

// Function to extract metadata from media files (audio/video)
async function extractMediaMetadata(url, contentType, contentLength, filename) {
  console.log(`Function called: extractMediaMetadata(${url}, ${contentType}, ${contentLength}, ${filename})`);
  const metadata = {
    filename: filename,
    contentType: contentType,
    size: contentLength ? `${(contentLength / (1024 * 1024)).toFixed(2)} MB` : 'Unknown size',
  };

  // Simulated metadata extraction
  if (contentType.startsWith('audio/') || contentType.startsWith('video/')) {
    metadata.type = contentType.includes('audio') ? 'Audio' : 'Video';
    metadata.description = `This is a ${metadata.type} file named ${filename}. Size: ${metadata.size}.`;
    metadata.duration = "Duration not available"; // Placeholder for actual media duration
  }

  return metadata;
}

// Function to handle unsupported files (PDFs, ZIP, etc.)
async function extractGenericFileMetadata(url, contentType, contentLength, filename) {
  console.log(`Function called: extractGenericFileMetadata(${url}, ${contentType}, ${contentLength}, ${filename})`);
  return {
    filename: filename,
    contentType: contentType,
    size: contentLength ? `${(contentLength / (1024 * 1024)).toFixed(2)} MB` : 'Unknown size',
    description: `This is a file named ${filename} of type ${contentType}. Size: ${contentLength ? `${contentLength} bytes` : 'Unknown size'}.`
  };
}

// Main function to handle website text, images, audio, video, and other files
async function interpretUrl(url, prompt = "Analyze the content and describe as much detail as possible.") {
  console.log(`Function called: interpretUrl(${url})`);
  try {
    const contentInfo = await getContentType(url);

    // If contentType is undefined, treat it as a website
    const contentType = contentInfo ? contentInfo.contentType : 'text/html';
    const contentLength = contentInfo ? contentInfo.contentLength : null;
    const filename = contentInfo ? contentInfo.filename : null;

    if (contentType.startsWith('text/')) {
      // Fetch and return website text content
      const websiteText = await fetchWebsiteText(url);
      const detailedDescription = await interpretWebsite(websiteText, prompt);
      console.log(`Website Interpretation: ${detailedDescription}`);
      return detailedDescription;

    } else if (contentType.startsWith('image/')) {
      // Pass the image URL to interpretImage with a prompt
      const imageInterpretation = await interpretImage(url, prompt);
      console.log(`Image Interpretation: ${imageInterpretation}`);
      return imageInterpretation;

    } else if (contentType.startsWith('audio/') || contentType.startsWith('video/')) {
      // Extract metadata from audio or video
      const mediaMetadata = await extractMediaMetadata(url, contentType, contentLength, filename);
      console.log(`Media Metadata: ${JSON.stringify(mediaMetadata, null, 2)}`);
      return mediaMetadata;

    } else {
      // Handle other file types (PDFs, ZIP, etc.)
      const fileMetadata = await extractGenericFileMetadata(url, contentType, contentLength, filename);
      console.log(`File Metadata: ${JSON.stringify(fileMetadata, null, 2)}`);
      return fileMetadata;
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return `Error: ${error.message}`;
  }
}

// Export functions for reuse in other modules
module.exports = {
  interpretUrl
};