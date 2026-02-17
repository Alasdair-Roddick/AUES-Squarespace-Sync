/**
 * @app index.ts
 * @description Periodically pings dashboard endpoints to trigger syncs.
 * - Orders: fixed 10-minute interval
 * - Members: adaptive interval based on the dashboard's response
 */


const ORDERS_URL = process.env.DASHBOARD_URL;
const MEMBERS_URL = process.env.MEMBERS_URL;
const CRON_SECRET = process.env.CRON_SECRET;
const MAX_RETRIES = 3;
const FETCH_TIMEOUT_MS = 30_000;
const CONSECUTIVE_FAILURE_THRESHOLD = 5;
const ORDERS_INTERVAL = 1000 * 60 * 10; // 10 minutes
const DEFAULT_MEMBERS_INTERVAL = 1000 * 60 * 5; // 5 minute fallback


// Check if the required environment variables are set
if (!CRON_SECRET) {
    console.error('CRON_SECRET is not set. Please set it in the environment variables.');
    process.exit(1);
}

if (!ORDERS_URL) {
    console.error('DASHBOARD_URL is not set. Please set it in the environment variables.');
    process.exit(1);
}

if (!MEMBERS_URL) {
    console.error('MEMBERS_URL is not set. Please set it in the environment variables.');
    process.exit(1);
}


const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 429]);

interface SyncResult {
    ok: boolean;
    data?: Record<string, unknown>;
}

const postWithRetry = async (url: string, label: string, consecutiveFailures: { count: number }): Promise<SyncResult> => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${CRON_SECRET}`
                },
                body: JSON.stringify({ message: `Sync ${label}` }),
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });

            if (!response.ok) {
                if (NON_RETRYABLE_STATUSES.has(response.status)) {
                    consecutiveFailures.count++;
                    console.error(`[${label}] Sync failed: ${response.status} ${response.statusText} (not retryable)`);
                    return { ok: false };
                }
                throw new Error(`${response.status} ${response.statusText}`);
            }

            consecutiveFailures.count = 0;
            const data = await response.json() as Record<string, unknown>;
            return { ok: true, data };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const isLastAttempt = attempt === MAX_RETRIES;

            if (isLastAttempt) {
                consecutiveFailures.count++;
                console.error(`[${label}] Sync failed after ${MAX_RETRIES} attempts: ${message}`);

                if (consecutiveFailures.count >= CONSECUTIVE_FAILURE_THRESHOLD) {
                    console.error(`[${label}] WARNING: ${consecutiveFailures.count} consecutive failures — check connectivity`);
                }
                return { ok: false };
            } else {
                const delay = Math.pow(2, attempt) * 1000;
                console.error(`[${label}] Attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${delay / 1000}s: ${message}`);
                await sleep(delay);
            }
        }
    }
    return { ok: false };
};


// --- Orders sync (fixed interval) ---

const ordersFailures = { count: 0 };

const syncOrders = async () => {
    const result = await postWithRetry(ORDERS_URL, 'orders', ordersFailures);
    if (result.ok) {
        console.log('[orders] Synced successfully');
    }
};

const ordersIntervalId = setInterval(syncOrders, ORDERS_INTERVAL);
syncOrders();


// --- Members sync (adaptive interval) ---

const membersFailures = { count: 0 };
let membersTimeoutId: ReturnType<typeof setTimeout>;

const syncMembers = async () => {
    const result = await postWithRetry(MEMBERS_URL, 'members', membersFailures);

    let nextInterval = DEFAULT_MEMBERS_INTERVAL;

    if (result.ok && result.data) {
        const nextCheckInSeconds = result.data.nextCheckInSeconds;
        if (typeof nextCheckInSeconds === 'number' && nextCheckInSeconds > 0) {
            nextInterval = nextCheckInSeconds * 1000;
        }
        console.log(`[members] Synced successfully (next check in ${nextInterval / 1000}s)`);
    }

    membersTimeoutId = setTimeout(syncMembers, nextInterval);
};

syncMembers();


// --- Graceful shutdown ---

const shutdown = (signal: string) => {
    console.log(`Received ${signal}, shutting down...`);
    clearInterval(ordersIntervalId);
    clearTimeout(membersTimeoutId);
    process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    process.exit(1);
});
