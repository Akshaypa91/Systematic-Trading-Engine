# .github/workflows/deploy.yml
name: CI / Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  # ── Lint + Build ─────────────────────────────────────────────────────────────
  build:
    name: Build & Validate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: |
            backend/package-lock.json
            frontend/package-lock.json

      - name: Install backend deps
        run: cd backend && npm ci

      - name: Check backend syntax
        run: |
          cd backend
          find src -name "*.js" | xargs node --check
          echo "✅ Backend syntax OK"

      - name: Install frontend deps
        run: cd frontend && npm ci

      - name: Build frontend
        run: cd frontend && npm run build
        env:
          VITE_API_URL: ${{ secrets.VITE_API_URL }}
          VITE_WS_URL: ${{ secrets.VITE_WS_URL }}
          VITE_GOOGLE_CLIENT_ID: ${{ secrets.VITE_GOOGLE_CLIENT_ID }}

      - name: Upload frontend build
        uses: actions/upload-artifact@v4
        with:
          name: frontend-dist
          path: frontend/dist
          retention-days: 1

  # ── Deploy Backend → Render ───────────────────────────────────────────────────
  deploy-backend:
    name: Deploy Backend (Render)
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    steps:
      - name: Trigger Render deploy
        run: |
          curl -s -X POST "${{ secrets.RENDER_DEPLOY_HOOK }}" \
            -H "Content-Type: application/json" | jq .
        # Set RENDER_DEPLOY_HOOK in GitHub repo secrets
        # Get from: Render dashboard → your service → Settings → Deploy Hook

  # ── Deploy Frontend → Vercel ──────────────────────────────────────────────────
  deploy-frontend:
    name: Deploy Frontend (Vercel)
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install Vercel CLI
        run: npm install -g vercel@latest

      - name: Deploy to Vercel
        run: |
          vercel --token ${{ secrets.VERCEL_TOKEN }} \
                 --prod \
                 --yes \
                 --cwd frontend
        env:
          VERCEL_ORG_ID:     ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}

  # ── PR Preview ────────────────────────────────────────────────────────────────
  preview:
    name: Preview Deploy (PR only)
    needs: build
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm install -g vercel@latest
      - name: Deploy Preview
        run: |
          url=$(vercel --token ${{ secrets.VERCEL_TOKEN }} --yes --cwd frontend)
          echo "Preview URL: $url"
          echo "preview_url=$url" >> $GITHUB_OUTPUT
        env:
          VERCEL_ORG_ID:     ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
          