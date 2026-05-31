import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const PRIVATE_KEY = '0x68e3a1210fd4d7afa8d05d152ea11bccb51086d61e77b39b575c006201d0f031';
const CONTRACT   = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const CALLDATA   = '0x8ea422860000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000ad646174613a6170706c69636174696f6e2f6a736f6e3b6261736536342c65794a755957316c496a6f69616d46695a57357661585232496977695a47567a59334a7063485270623234694f694a4264585276626d39746233567a4945464a4947466e5a57353049475a7663694233636d6c306157356e4c4342795a584e6c59584a6a614377675957356b49474e765a476c755a79423059584e7263794973496d6c745957646c496a6f69496e303d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000001c0000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000006736b696c6c730000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002077726974696e672c72657365617263682c636f64696e672c616e616c79736973000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000008656e64706f696e7400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000087072696365576569000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000038d7ea4c68000';
const CONFIG_PATH = process.env.HOME + '/.workclaw/workclaw.json';

async function main() {
  console.log('Lanzando Chromium...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Inject ethers.js from CDN
  console.log('Cargando ethers.js...');
  await page.goto('about:blank');
  await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/ethers@6.13.5/dist/ethers.umd.min.js' });

  console.log('Verificando conectividad con Base RPC...');
  const blockNumber = await page.evaluate(async () => {
    try {
      const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
      return await provider.getBlockNumber();
    } catch (e) {
      return 'ERROR: ' + e.message;
    }
  });

  console.log('Block number:', blockNumber);

  if (typeof blockNumber === 'string' && blockNumber.startsWith('ERROR')) {
    console.log('❌ Chromium tampoco puede llegar a Base RPC.');
    await browser.close();
    process.exit(1);
  }

  console.log('✅ Conectado a Base! Bloque actual:', blockNumber);
  console.log('Verificando balance de la wallet...');

  const balance = await page.evaluate(async (pk) => {
    const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
    const wallet = new ethers.Wallet(pk, provider);
    const bal = await provider.getBalance(wallet.address);
    return { address: wallet.address, balanceEth: ethers.formatEther(bal) };
  }, PRIVATE_KEY);

  console.log(`Wallet: ${balance.address}`);
  console.log(`Balance: ${balance.balanceEth} ETH`);

  if (parseFloat(balance.balanceEth) < 0.0001) {
    console.log('⏳ Balance insuficiente para gas. Esperando fondos...');
    console.log(`Mandá ETH a: ${balance.address}`);
    await browser.close();
    process.exit(2);
  }

  console.log('Enviando transacción de registro...');
  const result = await page.evaluate(async ({ pk, contract, calldata }) => {
    try {
      const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
      const wallet = new ethers.Wallet(pk, provider);
      const tx = await wallet.sendTransaction({
        to: contract,
        data: calldata,
        chainId: 8453,
      });
      console.log('TX hash:', tx.hash);
      const receipt = await tx.wait();
      // Find agentId from Registered event (indexed topic[1])
      let agentId = null;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() === contract.toLowerCase() && log.topics.length > 1) {
          agentId = BigInt(log.topics[1]).toString();
          break;
        }
      }
      return { txHash: tx.hash, agentId, status: receipt.status };
    } catch (e) {
      return { error: e.message };
    }
  }, { pk: PRIVATE_KEY, contract: CONTRACT, calldata: CALLDATA });

  await browser.close();

  if (result.error) {
    console.log('❌ Error en transacción:', result.error);
    process.exit(1);
  }

  console.log('✅ Transacción confirmada!');
  console.log('TX hash:', result.txHash);
  console.log('AgentId:', result.agentId);

  // Write agentId to config
  const fs = await import('fs');
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  config.agentId = result.agentId;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log('Config actualizada con agentId:', result.agentId);

  // Start the agent
  const res = await fetch('http://localhost:3777/api/setup/complete', { method: 'POST' });
  const json = await res.json();
  console.log('Agente iniciado:', json);
}

main().catch(e => { console.error(e); process.exit(1); });
