import express from 'express';
import cors from 'cors';
import fs from 'fs';

const app = express();
app.use(cors());
app.use(express.json());

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIG
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const PORT = process.env.PORT || 3001;
const HISTORY_FILE = './data/history.json';
const CONFIG_FILE = './data/alerts.json';

// Ensure data dir exists
if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });

// Load or init history
function loadHistory() {
    try {
        return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    } catch {
        return [];
    }
}

function saveHistory(history) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

// Load or init alert config
function loadAlertConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {
        const defaults = {
            discord: { enabled: true, webhookUrl: '' },
            telegram: { enabled: false, botToken: '', chatId: '' },
            alertOnHealthy: true,
            alertOnWarning: true,
            alertOnCritical: true,
        };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaults, null, 2));
        return defaults;
    }
}

function saveAlertConfig(config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DISCORD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function sendDiscord(webhookUrl, result) {
    const color = result.riskScore > 0 ? 15158332 : 3066993;
    const statusEmoji = result.severity === 'HEALTHY' ? '✅' : result.severity === 'WARNING' ? '⚠️' : '🚨';

    const protocolLines = result.protocols.map(p => {
        const emoji = parseFloat(p.solvency) >= 95 ? '✅' : parseFloat(p.solvency) >= 90 ? '⚠️' : '🚨';
        return `${emoji} **${p.name}**: ${p.solvency}%`;
    }).join('\n');

    const tvlLines = result.offchain.map(o =>
        `**${o.slug}**: $${Number(o.tvl).toLocaleString()}`
    ).join('\n');

    const fields = [
        { name: '📊 Protocol Solvency', value: protocolLines, inline: false },
        { name: '🔗 Chains', value: result.chains.map(c => `\`${c}\``).join(', '), inline: false },
        { name: 'Risk Score', value: `${result.riskScore}/100`, inline: true },
        { name: 'Reserves', value: `$${Number(result.aggregate.totalActualUSD).toLocaleString()}`, inline: true },
        { name: 'Anomaly', value: result.anomalyDetected ? '🔴 YES' : '✅ NO', inline: true },
        { name: '🌐 DeFiLlama TVL', value: tvlLines, inline: false },
    ];

    if (result.txHash && !result.txHash.startsWith('0x000000000000')) {
        fields.push({
            name: '📜 Transaction',
            value: `[View on Etherscan](https://sepolia.etherscan.io/tx/${result.txHash})`,
            inline: false,
        });
    }

    const payload = {
        username: 'SENTINAL Guardian',
        avatar_url: 'https://raw.githubusercontent.com/chainlink/chainlink/develop/docs/logo-chainlink-blue.png',
        embeds: [{
            title: `${statusEmoji} Health Check #${result.checkNumber} — ${result.severity}`,
            color,
            fields,
            footer: { text: 'Powered by Chainlink CRE | SENTINAL' },
            timestamp: new Date().toISOString(),
        }],
    };

    const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Discord ${res.status}: ${text}`);
    }

    return { success: true, platform: 'discord' };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TELEGRAM
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function sendTelegram(botToken, chatId, result) {
    const statusEmoji = result.severity === 'HEALTHY' ? '✅' : result.severity === 'WARNING' ? '⚠️' : '🚨';

    const protocolLines = result.protocols.map(p => {
        const emoji = parseFloat(p.solvency) >= 95 ? '✅' : parseFloat(p.solvency) >= 90 ? '⚠️' : '🚨';
        return `${emoji} <b>${p.name}</b>: ${p.solvency}%`;
    }).join('\n');

    const text = `${statusEmoji} <b>SENTINAL Health Check #${result.checkNumber}</b>\n\n`
        + `<b>Status:</b> ${result.severity}\n`
        + `<b>Risk Score:</b> ${result.riskScore}/100\n`
        + `<b>Chains:</b> ${result.chains.length}\n`
        + `<b>Reserves:</b> $${Number(result.aggregate.totalActualUSD).toLocaleString()}\n\n`
        + `<b>Protocols:</b>\n${protocolLines}\n\n`
        + `<i>Powered by Chainlink CRE</i>`;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        }),
    });

    if (!res.ok) {
        const data = await res.json();
        throw new Error(`Telegram ${res.status}: ${data.description}`);
    }

    return { success: true, platform: 'telegram' };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// POST /api/report — Receives CRE workflow result, stores + sends alerts
app.post('/api/report', async (req, res) => {
    try {
        const result = req.body;
        console.log(`\n📥 Received Check #${result.checkNumber} — ${result.severity}`);

        // Store in history
        const history = loadHistory();
        history.push({
            ...result,
            receivedAt: new Date().toISOString(),
        });
        // Keep last 100 checks
        if (history.length > 100) history.splice(0, history.length - 100);
        saveHistory(history);

        // Send alerts
        const alertConfig = loadAlertConfig();
        const alertResults = [];

        // Check if we should alert for this severity
        const shouldAlert =
            (result.severity === 'HEALTHY' && alertConfig.alertOnHealthy) ||
            (result.severity === 'WARNING' && alertConfig.alertOnWarning) ||
            (result.severity === 'CRITICAL' && alertConfig.alertOnCritical);

        if (shouldAlert) {
            // Discord
            if (alertConfig.discord.enabled && alertConfig.discord.webhookUrl) {
                try {
                    const r = await sendDiscord(alertConfig.discord.webhookUrl, result);
                    alertResults.push(r);
                    console.log('   ✅ Discord alert sent');
                } catch (err) {
                    alertResults.push({ success: false, platform: 'discord', error: err.message });
                    console.log(`   ❌ Discord failed: ${err.message}`);
                }
            }

            // Telegram
            if (alertConfig.telegram.enabled && alertConfig.telegram.botToken && alertConfig.telegram.chatId) {
                try {
                    const r = await sendTelegram(alertConfig.telegram.botToken, alertConfig.telegram.chatId, result);
                    alertResults.push(r);
                    console.log('   ✅ Telegram alert sent');
                } catch (err) {
                    alertResults.push({ success: false, platform: 'telegram', error: err.message });
                    console.log(`   ❌ Telegram failed: ${err.message}`);
                }
            }
        } else {
            console.log(`   ⏭️  Skipped alerts (${result.severity} alerts disabled)`);
        }

        res.json({
            stored: true,
            checkNumber: result.checkNumber,
            alerts: alertResults,
        });
    } catch (err) {
        console.error('❌ Error processing report:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/history — Returns all stored health checks
app.get('/api/history', (req, res) => {
    const history = loadHistory();
    res.json(history);
});

// GET /api/latest — Returns the most recent health check
app.get('/api/latest', (req, res) => {
    const history = loadHistory();
    if (history.length === 0) return res.json(null);
    res.json(history[history.length - 1]);
});

// GET /api/alerts/config — Get alert configuration
app.get('/api/alerts/config', (req, res) => {
    res.json(loadAlertConfig());
});

// PUT /api/alerts/config — Update alert configuration (from frontend)
app.put('/api/alerts/config', (req, res) => {
    const config = req.body;
    saveAlertConfig(config);
    console.log('📝 Alert config updated');
    res.json({ success: true, config });
});

// POST /api/alerts/test — Send a test alert
app.post('/api/alerts/test', async (req, res) => {
    const alertConfig = loadAlertConfig();
    const testResult = {
        checkNumber: 0,
        severity: 'HEALTHY',
        riskScore: 0,
        chains: ['ethereum-mainnet', 'ethereum-mainnet-arbitrum-1', 'ethereum-mainnet-base-1'],
        protocols: [
            { name: 'Aave V3 USDC (Ethereum)', solvency: '100.01', type: 'aave', chain: 'ethereum-mainnet' },
            { name: 'Aave V3 USDC (Arbitrum)', solvency: '100.00', type: 'aave', chain: 'ethereum-mainnet-arbitrum-1' },
            { name: 'Aave V3 USDC (Base)', solvency: '100.00', type: 'aave', chain: 'ethereum-mainnet-base-1' },
            { name: 'Lido stETH', solvency: '100.00', type: 'lido', chain: 'ethereum-mainnet' },
        ],
        aggregate: { totalActualUSD: '4608879987', totalClaimedUSD: '4608644781', worstSolvency: '100.00', worstProtocol: 'Aave V3 USDC (Arbitrum)' },
        offchain: [{ slug: 'aave-v3', tvl: '26521101800' }, { slug: 'lido', tvl: '18784862477' }],
        anomalyDetected: false,
        txHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    };

    const results = [];

    if (alertConfig.discord.enabled && alertConfig.discord.webhookUrl) {
        try {
            await sendDiscord(alertConfig.discord.webhookUrl, testResult);
            results.push({ platform: 'discord', success: true });
        } catch (err) {
            results.push({ platform: 'discord', success: false, error: err.message });
        }
    }

    if (alertConfig.telegram.enabled && alertConfig.telegram.botToken) {
        try {
            await sendTelegram(alertConfig.telegram.botToken, alertConfig.telegram.chatId, testResult);
            results.push({ platform: 'telegram', success: true });
        } catch (err) {
            results.push({ platform: 'telegram', success: false, error: err.message });
        }
    }

    res.json({ results });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// START
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.listen(PORT, () => {
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🛡️  SENTINAL Alert Server');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📡 API:     http://localhost:${PORT}`);
    console.log(`📥 Report:  POST /api/report`);
    console.log(`📊 History: GET  /api/history`);
    console.log(`🔔 Config:  GET/PUT /api/alerts/config`);
    console.log(`🧪 Test:    POST /api/alerts/test`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
});
