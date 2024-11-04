const { ethers } = require('ethers');
const { mintclub } = require('mint.club-v2-sdk');
require('dotenv').config();

const privateKey = process.env.PRIVATE_KEY;
const infuraProjectId = process.env.INFURA_PROJECT_ID;
const filebaseApiKey = process.env.FILEBASE_API_KEY;

// Set up the provider using Infura for Sepolia network
const provider = new ethers.JsonRpcProvider(`https://sepolia.infura.io/v3/${infuraProjectId}`);
const wallet = new ethers.Wallet(privateKey, provider);

// Sepolia WETH contract address
const sepoliaWETH = {
  address: "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9",
  decimals: 18,
};

// Bond contract ABI (simplified for createMultiToken function)
const BOND_ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: 'string', name: 'name', type: 'string' },
          { internalType: 'string', name: 'symbol', type: 'string' },
          { internalType: 'string', name: 'uri', type: 'string' },
        ],
        internalType: 'struct MCV2_Bond.MultiTokenParams',
        name: 'tp',
        type: 'tuple',
      },
      {
        components: [
          { internalType: 'uint16', name: 'mintRoyalty', type: 'uint16' },
          { internalType: 'uint16', name: 'burnRoyalty', type: 'uint16' },
          { internalType: 'address', name: 'reserveToken', type: 'address' },
          { internalType: 'uint128', name: 'maxSupply', type: 'uint128' },
          { internalType: 'uint128[]', name: 'stepRanges', type: 'uint128[]' },
          { internalType: 'uint128[]', name: 'stepPrices', type: 'uint128[]' },
        ],
        internalType: 'struct MCV2_Bond.BondParams',
        name: 'bp',
        type: 'tuple',
      },
    ],
    name: 'createMultiToken',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'payable',
    type: 'function',
  },
];

// Bond contract address on Sepolia
const bondContractAddress = "0x8dce343A86Aa950d539eeE0e166AFfd0Ef515C0c"; // Replace with actual contract address

// Instantiate the bond contract
const bondContract = new ethers.Contract(bondContractAddress, BOND_ABI, wallet);

async function uploadImageToIPFS(imageUrl) {
  if (!filebaseApiKey) {
    throw new Error("Filebase API key is missing. Please set FILEBASE_API_KEY in your environment variables.");
  }

  try {
    console.log("Uploading image to IPFS:", imageUrl);

    // Fetch the image and convert it to a blob
    const response = await fetch(imageUrl);
    const arrayBuffer = await response.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: 'image/png' });

    // Call mintclub.ipfs.add with blob and API key
    const ipfsHash = await mintclub.ipfs.add(filebaseApiKey, blob);
    const ipfsUrl = `ipfs://${ipfsHash}`;

    console.log("Uploaded to IPFS with URL:", ipfsUrl);
    return ipfsUrl;
  } catch (error) {
    console.error("Error uploading to IPFS:", error);
    throw new Error("Failed to upload image to IPFS");
  }
}

async function uploadMetadataToIPFS(imageIpfsUrl, name, description) {
  try {
    console.log("Uploading metadata to IPFS...");

    const metadataIpfsUrl = await mintclub.ipfs.uploadMetadata({
      filebaseApiKey,
      image: imageIpfsUrl,
      name,
      description,
      external_url: 'https://mint.club',
      attributes: [{ trait_type: 'rarity', value: 'legendary' }],
    });

    console.log("Metadata uploaded to IPFS with URL:", metadataIpfsUrl);
    return metadataIpfsUrl;
  } catch (error) {
    console.error("Error uploading metadata to IPFS:", error);
    throw new Error("Failed to upload metadata to IPFS");
  }
}

async function createNewToken(name, symbol, metadataUrl) {
  try {
    // Define token parameters as per the MultiToken function structure
    const tokenParams = {
      name,
      symbol,
      uri: metadataUrl,
    };

    // Define bonding parameters based on the provided values
    const bondParams = {
      mintRoyalty: 30,  // Setting mint royalty as in the example
      burnRoyalty: 30,  // Setting burn royalty as in the example
      reserveToken: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',  // Using example address
      maxSupply: 100,  // Adjusted max supply from the example
      stepRanges: Array.from({ length: 100 }, (_, i) => i + 1),  // Example range, 1 to 100
      stepPrices: [
        "1000000000000000", "1047615752789665", "1097498765493056", "1149756995397736",
        "1204503540258782", "1261856883066020", "1321941148466029", "1384886371393873",
        "1450828778495940", "1519911082952934", "1592282793341092", "1668100537200058",
        "1747528400007683", "1830738280295367", "1917910261672487", "2009233002565045",
        "2104904144512018", "2205130739903043", "2310129700083157", "2420128264794379",
        "2535364493970108", "2656087782946682", "2782559402207120", "2915053062825172",
        "3053855508833411", "3199267137797379", "3351602650938838", "3511191734215127",
        "3678379771828629", "3853528593710524", "4037017258596549", "4229242874389492",
        "4430621457583873", "4641588833612771", "4862601580065345", "5094138014816370",
        "5336699231206300", "5590810182512214", "5857020818056656", "6135907273413162",
        "6428073117284309", "6734150657750809", "7054802310718630", "7390722033525764",
        "7742636826811256", "8111308307896857", "8497534359086428", "8902150854450371",
        "9326033468832182", "9770099572992236", "10235310218990244", "10722672220103212",
        "11233240329780254", "11768119524349963", "12328467394420640", "12915496650148815",
        "13530477745798046", "14174741629268026", "14849682622544623", "15556761439304689",
        "16297508346206410", "17073526474706873", "17886495290574313", "18738174228603802",
        "19630406500402670", "20565123083486472", "21544346900318794", "22570197196339153",
        "23644894126454024", "24770763559917055", "25950242113997303", "27185882427329347",
        "28480358684357953", "29836472402833325", "31257158496882290", "32745491628777210",
        "34304692863149105", "35938136638046195", "37649358067924600", "39442060594376466",
        "41320124001153270", "43287612810830480", "45348785081285710", "47508101621027850",
        "49770235643320990", "52140082879996726", "54622772176843280", "57223676593502030",
        "59948425031893950", "62802914418342360", "65793322465756630", "68926121043496800",
        "72208090183854450", "75646332755462690", "79248289835391520", "83021756813197220",
        "86974900261778100", "91116275611548670", "95454845666183130", "99999999999999710"
      ],  // Adjusted step prices based on example
    };

    console.log("Attempting to create token with parameters:");
    console.log("Token Params:", tokenParams);
    console.log("Bond Params:", bondParams);

    // Send transaction using createMultiToken function
    const tx = await bondContract.createMultiToken(tokenParams, bondParams, {
      gasLimit: 3000000,  // Manually set gas limit
    });

    console.log("Transaction sent, waiting for confirmation...");
    console.log("Transaction details:", tx);

    const receipt = await tx.wait();
    console.log("Token created successfully, transaction receipt:", receipt);

    return receipt;
  } catch (error) {
    console.error("Error deploying NFT contract:", error);
    return undefined;
  }
}

// Main function to create and mint an ERC-1155 NFT
async function createAndMintNFT(contractName, symbol, contractUriImageUrl, description) {
  if (!contractUriImageUrl) throw new Error("Contract image URL is undefined.");

  try {
    const imageIpfsUrl = await uploadImageToIPFS(contractUriImageUrl); // Upload image to IPFS
    const metadataUrl = await uploadMetadataToIPFS(imageIpfsUrl, contractName, description); // Upload metadata to IPFS
    const contractAddress = await createNewToken(contractName, symbol, metadataUrl); // Deploy contract with bonding curve

    if (contractAddress) {
      console.log("NFT contract created successfully on Sepolia:", contractAddress);
      return contractAddress;
    }
  } catch (error) {
    console.error("Error in NFT creation and minting process:", error);
  }
}

// Usage example
// createAndMintNFT('test contract1', 'SYMBOL', 'https://heads.mfers.dev/7444.png', 'This is a test NFT description');

module.exports = {
  createAndMintNFT,
};