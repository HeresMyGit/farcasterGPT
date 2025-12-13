import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Generate a session ID for this user
const sessionId = 'session_' + Math.random().toString(36).substring(2, 15);

// Generate a random mfer ID for user avatar (0-10020)
const userMferId = Math.floor(Math.random() * 10021);
const userAvatarUrl = `https://plain.mfers.dev/${userMferId}.png`;

// DOM Elements
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const modelContainer = document.getElementById('model-container');
const modelCanvas = document.getElementById('model-canvas');
const modelLoading = document.getElementById('model-loading');

// ============ 3D Model Setup ============
let scene, camera, renderer, model, mixer;
let clock = new THREE.Clock();

function init3DModel() {
  // Scene
  scene = new THREE.Scene();
  
  // Camera
  const aspect = modelContainer.clientWidth / modelContainer.clientHeight;
  camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
  camera.position.set(0, 0.5, 2.5);
  
  // Renderer
  renderer = new THREE.WebGLRenderer({ 
    canvas: modelCanvas, 
    alpha: true, 
    antialias: true 
  });
  renderer.setSize(modelContainer.clientWidth, modelContainer.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0; // Slightly reduced to prevent washing out
  
  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
  directionalLight.position.set(5, 10, 7.5);
  scene.add(directionalLight);
  
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
  fillLight.position.set(-5, 5, -5);
  scene.add(fillLight);
  
  const rimLight = new THREE.DirectionalLight(0xffb671, 0.4);
  rimLight.position.set(0, 5, -10);
  scene.add(rimLight);
  
  // Load the model
  const loader = new GLTFLoader();
  loader.load(
    '/models/mferGPT.glb',
    (gltf) => {
      model = gltf.scene;
      
      // Center and scale the model
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 1.4 / maxDim;
      model.scale.setScalar(scale);
      
      // Position to show upper body/head (move model down significantly so top half is visible)
      model.position.x = -center.x * scale;
      model.position.y = -center.y * scale - 3.0; // Adjusted for new scale
      model.position.z = -center.z * scale;
      
      // Static rotation: 30 degrees clockwise (positive Y rotation)
      model.rotation.y = Math.PI / 6; // +30 degrees
      
      scene.add(model);
      
      // Boost emissive materials (for the red light on top)
      model.traverse((child) => {
        if (child.isMesh && child.material) {
          const mat = child.material;
          // Check if material has emissive color set
          if (mat.emissive && (mat.emissive.r > 0.1 || mat.emissive.g > 0.1 || mat.emissive.b > 0.1)) {
            mat.emissiveIntensity = 1.5; // Moderate emissive intensity
            console.log('Boosted emissive material:', mat.name, mat.emissive);
          }
        }
      });
      
      // Handle animations if present
      if (gltf.animations && gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(model);
        const action = mixer.clipAction(gltf.animations[0]);
        action.play();
      }
      
      // Hide loading indicator
      modelLoading.classList.add('hidden');
      
      console.log('Model loaded successfully');
    },
    (progress) => {
      const percent = (progress.loaded / progress.total * 100).toFixed(0);
      console.log(`Loading model: ${percent}%`);
    },
    (error) => {
      console.error('Error loading model:', error);
      modelLoading.innerHTML = '<p>failed to load mfer :(</p>';
    }
  );
  
  // Handle window resize
  window.addEventListener('resize', onWindowResize);
  
  // Start animation loop
  animate();
}

function onWindowResize() {
  const width = modelContainer.clientWidth;
  const height = modelContainer.clientHeight;
  
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  
  renderer.setSize(width, height);
}

function animate() {
  requestAnimationFrame(animate);
  
  const delta = clock.getDelta();
  
  // Update animation mixer
  if (mixer) {
    mixer.update(delta);
  }
  
  // Model is static - no rotation
  
  renderer.render(scene, camera);
}

// Initialize 3D model
init3DModel();

// ============ Chat Functionality ============

function addMessage(text, isUser = false) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${isUser ? 'user-message' : 'bot-message'}`;
  
  const avatarImg = document.createElement('img');
  avatarImg.className = 'message-avatar';
  avatarImg.src = isUser ? userAvatarUrl : '/mfergpt.png';
  avatarImg.alt = isUser ? 'You' : 'mferGPT';
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.innerHTML = `<p>${escapeHtml(text)}</p>`;
  
  messageDiv.appendChild(avatarImg);
  messageDiv.appendChild(contentDiv);
  
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  
  return messageDiv;
}

function addTypingIndicator() {
  const typingDiv = document.createElement('div');
  typingDiv.className = 'message bot-message';
  typingDiv.id = 'typing-indicator';
  
  const avatarImg = document.createElement('img');
  avatarImg.className = 'message-avatar';
  avatarImg.src = '/mfergpt.png';
  avatarImg.alt = 'mferGPT';
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.innerHTML = `
    <div class="typing-indicator">
      <span></span>
      <span></span>
      <span></span>
    </div>
  `;
  
  typingDiv.appendChild(avatarImg);
  typingDiv.appendChild(contentDiv);
  
  chatMessages.appendChild(typingDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeTypingIndicator() {
  const typing = document.getElementById('typing-indicator');
  if (typing) {
    typing.remove();
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function sendMessage() {
  const message = chatInput.value.trim();
  if (!message) return;
  
  // Disable input while processing
  chatInput.value = '';
  chatInput.disabled = true;
  sendBtn.disabled = true;
  
  // Add user message
  addMessage(message, true);
  
  // Show typing indicator
  addTypingIndicator();
  
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: message,
        sessionId: sessionId
      }),
    });
    
    const data = await response.json();
    
    // Remove typing indicator
    removeTypingIndicator();
    
    // Add bot response
    addMessage(data.response || data.error || 'something went wrong mfer');
    
  } catch (error) {
    console.error('Error sending message:', error);
    removeTypingIndicator();
    addMessage('sorry mfer, something went wrong. try again?');
  }
  
  // Re-enable input
  chatInput.disabled = false;
  sendBtn.disabled = false;
  chatInput.focus();
}

// Event listeners
sendBtn.addEventListener('click', sendMessage);

chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Focus input on load
chatInput.focus();

console.log('mferGPT website initialized');

