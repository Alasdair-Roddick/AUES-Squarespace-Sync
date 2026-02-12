/**
 * @app index.ts
 * @description sends a post request to a url with a json body and authorization header. This is then used to trigger a database sync on the AUES dashboard.
 */


const DASHBOARD_URL = process.env.DASHBOARD_URL
const CRON_SECRET = process.env.CRON_SECRET;
const SYNC_INTERVAL = 1000 * 10 * 60;
const MAX_RETRIES = 3;
const FETCH_TIMEOUT_MS = 30_000;
const CONSECUTIVE_FAILURE_THRESHOLD = 5;


// Check if the required environment variables are set
if (!CRON_SECRET) {
    console.error('CRON_SECRET is not set. Please set it in the environment variables.');
    process.exit(1);
}

if (!DASHBOARD_URL) {
    console.error('DASHBOARD_URL is not set. Please set it in the environment variables.');
    process.exit(1);
}


let consecutiveFailures = 0;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * @description sends a post request to the dashboard url with a json body and authorization header. This is then used to trigger a database sync on the AUES dashboard.
 */
const syncOrders = async () => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(DASHBOARD_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${CRON_SECRET}`
                },
                body: JSON.stringify({ message: 'Sync orders' }),
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });

            if (!response.ok) {
                throw new Error(`Failed to sync orders: ${response.status} ${response.statusText}`);
            }

            consecutiveFailures = 0;
            console.log('Orders synced successfully');
            return;
        } catch (error) {
            const isLastAttempt = attempt === MAX_RETRIES;

            if (isLastAttempt) {
                consecutiveFailures++;
                console.error(`Sync failed after ${MAX_RETRIES} attempts:`, error);

                if (consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
                    console.error(`WARNING: ${consecutiveFailures} consecutive sync failures — check dashboard connectivity`);
                }
            } else {
                const delay = Math.pow(2, attempt) * 1000;
                console.error(`Sync attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${delay / 1000}s...`, error);
                await sleep(delay);
            }
        }
    }
};

// Graceful shutdown
const intervalId = setInterval(syncOrders, SYNC_INTERVAL);

const shutdown = (signal: string) => {
    console.log(`Received ${signal}, shutting down...`);
    clearInterval(intervalId);
    process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Global error handlers
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    process.exit(1);
});

syncOrders();
