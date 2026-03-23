#!/usr/bin/env node
import fs from 'node:fs/promises';

const ISSUER = process.argv[2] || 'rsbvxRFMqFWeNm1BqzweFcyxsH8bPhpeCd';
const HISTORY_ENDPOINTS = (process.env.XRPL_HISTORY_ENDPOINTS || 'https://xrplcluster.com,https://honeycluster.io').split(',').map(s => s.trim()).filter(Boolean);
const NFTINFO_ENDPOINT = process.env.XRPL_NFTINFO_ENDPOINT || 'https://honeycluster.io';
const safe = ISSUER.replace(/[^a-zA-Z0-9]/g, '_');
const OUT_FILE = `${process.cwd()}/issued_nfts_${safe}.txt`;
const LOG_FILE = `${process.cwd()}/issued_nfts_${safe}.progress.log`;
let epIndex = 0;

async function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  await fs.appendFile(LOG_FILE, line + '\n');
}

async function rpcTo(ep, method, params) {
  const res = await fetch(ep, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, params: [params] })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${ep}`);
  const json = await res.json();
  if (json.result?.error) throw new Error(`${json.result.error} @ ${ep}`);
  return json.result;
}

async function rpcHistory(method, params, attempt = 0) {
  const ep = HISTORY_ENDPOINTS[epIndex % HISTORY_ENDPOINTS.length];
  epIndex += 1;
  try {
    return await rpcTo(ep, method, params);
  } catch (e) {
    if (attempt + 1 < HISTORY_ENDPOINTS.length * 3) {
      await new Promise(r => setTimeout(r, 300));
      return rpcHistory(method, params, attempt + 1);
    }
    throw e;
  }
}

function idsFromNFTokens(arr) {
  const s = new Set();
  for (const x of (arr || [])) {
    const inner = x?.NFToken || x || {};
    if (inner.NFTokenID) s.add(inner.NFTokenID);
  }
  return s;
}

function extractMintedId(meta) {
  for (const wrapped of (meta?.AffectedNodes || [])) {
    const mod = wrapped.ModifiedNode;
    if (!mod) continue;
    const finalFields = mod.FinalFields || {};
    const prevFields = mod.PreviousFields || {};
    if (!finalFields.NFTokens || !prevFields.NFTokens) continue;
    const finalIds = idsFromNFTokens(finalFields.NFTokens);
    const prevIds = idsFromNFTokens(prevFields.NFTokens);
    const added = [...finalIds].filter(x => !prevIds.has(x));
    if (added.length === 1) return added[0];
  }
  return null;
}

async function fetchMintedNFTIds(account) {
  let marker;
  let page = 0;
  const ids = [];
  while (true) {
    page += 1;
    const result = await rpcHistory('account_tx', {
      account,
      ledger_index_min: -1,
      ledger_index_max: -1,
      binary: false,
      forward: true,
      limit: 200,
      marker
    });
    for (const item of (result.transactions || [])) {
      const tx = item.tx || {};
      const meta = item.meta || {};
      if (tx.TransactionType !== 'NFTokenMint') continue;
      if (meta.TransactionResult !== 'tesSUCCESS') continue;
      const id = extractMintedId(meta);
      if (id) ids.push(id);
    }
    if (page % 5 === 0) await log(`phase1 account_tx pages=${page} extracted_ids=${ids.length}`);
    if (!result.marker) break;
    marker = result.marker;
  }
  await log(`phase1 done pages=${page} extracted_ids=${ids.length}`);
  return ids;
}

async function nftOwner(nftId) {
  const result = await rpcTo(NFTINFO_ENDPOINT, 'nft_info', { nft_id: nftId });
  return result?.owner || result?.nft_info?.owner || result?.nft?.owner || null;
}

async function main() {
  await fs.writeFile(OUT_FILE, '');
  await fs.writeFile(LOG_FILE, '');
  await log(`start issuer=${ISSUER} history_endpoints=${HISTORY_ENDPOINTS.join(',')} nftinfo=${NFTINFO_ENDPOINT}`);

  const nftIds = await fetchMintedNFTIds(ISSUER);
  if (!nftIds.length) throw new Error('No NFT IDs extracted from mint tx history');

  let found = 0;
  for (let i = 0; i < nftIds.length; i++) {
    const nftId = nftIds[i];
    try {
      const owner = await nftOwner(nftId);
      if (owner) {
        await fs.appendFile(OUT_FILE, `https://bithomp.com/en/account/${owner}|https://bithomp.com/en/nft/${nftId}\n`);
        found += 1;
      }
    } catch (_) {}
    if ((i + 1) % 25 === 0) await log(`phase2 progress ${i + 1}/${nftIds.length} found=${found}`);
  }
  await log(`done extracted=${nftIds.length} found=${found} output=${OUT_FILE}`);
  console.log(OUT_FILE);
}

main().catch(async err => {
  try { await log(`fatal ${err.message || String(err)}`); } catch {}
  process.exit(1);
});
