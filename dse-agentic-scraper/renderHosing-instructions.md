# Guide: Hosting on Render.com for Free

To host this application on Render's free tier, follow these steps. 

## 1. Prerequisites
- **GitHub/GitLab/Bitbucket Account**: Your code should be pushed to a repository on one of these platforms.
- **Render Account**: Sign up at [Render.com](https://render.com/).
- **External Database**: Render provides free PostgreSQL, but your app uses **MySQL**. You will need a free MySQL database provider like:
  - [Aiven](https://aiven.io/mysql)
  - [TiDB Serverless](https://www.pingcap.com/tidb-serverless/)
  - [Clever Cloud](https://www.clever-cloud.com/)

## 2. Setting Up using Blueprint (Recommended)
I have created a file named `renderHosing-render.yaml`. This is a Render Blueprint file that defines your web service.

1. Go to the Render Dashboard.
2. Click **New** -> **Blueprint**.
3. Connect your repository.
4. Render will automatically detect the `renderHosing-render.yaml` (if you rename it to `render.yaml`) or you can specify the path to `renderHosing-render.yaml` when prompted.
5. Render will prompt you to enter the environment variables (like `DB_HOST`, `OPENAI_API_KEY`, etc.). Fill them in with your external MySQL database credentials and API keys.

## 3. Manual Setup (Alternative)
If you prefer not to use the Blueprint:
1. Go to the Render Dashboard and click **New** -> **Web Service**.
2. Connect your repository.
3. Configure the following settings:
   - **Name**: `dse-agentic-scraper` (or any name you prefer)
   - **Environment**: `Docker` (This is crucial as your app requires Playwright, which needs specific OS dependencies handled by your `Dockerfile`).
   - **Instance Type**: `Free`
4. Expand the **Advanced** section and add your Environment Variables:
   - `PORT`: `3000`
   - `DB_HOST`: *Your external DB host*
   - `DB_USER`: *Your external DB user*
   - `DB_PASSWORD`: *Your external DB password*
   - `DB_NAME`: *Your external DB name*
   - `OPENAI_API_KEY`: *Your OpenAI API key*
5. Click **Create Web Service**.

## Important Notes on Free Tier Limitations
- **Cold Starts**: Render free instances spin down after 15 minutes of inactivity. The first request after a period of inactivity might take up to a minute to respond while the instance spins back up.
- **RAM**: Free web services have a limit of 512MB RAM. Running Playwright browsers can be memory-intensive. Keep an eye on memory usage; if it crashes frequently, you might need to limit concurrency in your scraper.
- **Outbound IPs**: Free services share outbound IPs, which is usually fine unless the target site strictly limits IP ranges.
