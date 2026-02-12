/**
 * @app index.ts
 * @description sends a post request to a url with a json body and authorization header. This is then used to trigger a database sync on the AUES dashboard.
 */


const DASHBOARD_URL = process.env.DASHBOARD_URL
const CRON_SECRET = process.env.CRON_SECRET;
const SYNC_INTERVAL = 1000 * 10 * 60;


// Check if the required environment variables are set
if (!CRON_SECRET) {
    console.error('CRON_SECRET is not set. Please set it in the environment variables.');
    process.exit(1);
}

if (!DASHBOARD_URL) {
    console.error('DASHBOARD_URL is not set. Please set it in the environment variables.');
    process.exit(1);
}



/**
 * @description sends a post request to the dashboard url with a json body and authorization header. This is then used to trigger a database sync on the AUES dashboard.
 */
const syncOrders = async () => {
    try {
        const response = await fetch(DASHBOARD_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CRON_SECRET}`
            },
            body: JSON.stringify({ message: 'Sync orders' })
        });

        if (!response.ok) {
            throw new Error(`Failed to sync orders: ${response.statusText}`);
        }

        console.log('Orders synced successfully');
    } catch (error) {
        console.error('Error syncing orders:', error);
    }
};

setInterval(syncOrders, SYNC_INTERVAL);

syncOrders();