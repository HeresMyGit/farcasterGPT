// personalPrompt.js

const { loadPersonalPrompts, savePersonalPrompts } = require('./threadUtils');

function setPersonalPrompt(fid, prompt) {
  const prompts = loadPersonalPrompts();
  prompts[fid] = prompt;
  savePersonalPrompts(prompts);
}

function getPersonalPrompt(fid) {
  const prompts = loadPersonalPrompts();
  return prompts[fid];
}

module.exports = {
  setPersonalPrompt,
  getPersonalPrompt,
};