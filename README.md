# FoodBridge: Cloud-Based Food Surplus Prediction and Hyperlocal Redistribution Network

CNAD (24CND3101) · Team 6 · Y. Bhavika, N. Keerthi Sri, Y. Adarsh Rishi · Guide: P. Srilatha / V. Vinisha

## Project details

**Problem.** Restaurants, hotels, supermarkets, cafeterias and events produce surplus food every day, but it is usually discovered too late and is hard to match with nearby people who need it, so usable food is wasted.

**Solution.** FoodBridge is a cloud-native web platform that (1) predicts how much surplus a donor will have and when, (2) matches posted food with nearby verified NGOs, shelters, community kitchens and food banks, (3) notifies them instantly, and (4) tracks every pickup until delivery.

**Users.** Donor (posts surplus), Receiver (accepts and collects food), Admin (verifies receivers, sees platform analytics).

**Objectives covered.** Register and monitor surplus; predict quantity and timing; hyperlocal matching using proximity, food type, quantity, urgency, receiver capacity and pickup availability; notifications and end-to-end tracking; dashboards with impact metrics.

### Technology stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript, Leaflet + OpenStreetMap |
| Backend | Node.js, Express, REST APIs, service-oriented modules behind an API gateway |
| Prediction (ML) | Ensemble time-series forecasting (day-of-week mean + moving average) with back-testing |
| Datastore | Embedded JSON store (swappable for PostgreSQL) |
| Containerisation | Docker |
| Orchestration | Kubernetes on Minikube, packaged and deployed with Helm |
| Cloud hosting (optional) | Render |
| Testing | Automated end-to-end test (`npm test`), Postman-compatible REST API |

### Cloud-native deployment (Docker + Helm + Minikube)

- **Docker:** `Dockerfile` packages the app into one image (Node 20 Alpine).
- **Helm:** `helm/foodbridge` is the chart (Deployment, Service, Secret, PersistentVolumeClaim). Settings such as image, replicas, port, resources and secret live in `values.yaml`.
- **Minikube:** runs a local Kubernetes cluster. The Deployment has readiness/liveness probes on `/api/health`, resource requests/limits, a Secret for the token key and a persistent volume for data.

## Run it (3 steps)

1. Install **Node.js LTS** (v18 or newer) from https://nodejs.org (skip if `node -v` already works).
2. Open a terminal in this folder and run:
   ```
   npm install
   npm start
   ```
   (Windows shortcut: double-click `run.bat`. Mac/Linux: `./run.sh`.)
3. Open **http://localhost:3000**

No database to install. Demo data (6 donors, 6 verified receivers, 90 days of history) is created on first start.

## Demo accounts (password for all: `password123`)

| Role | Email | Notes |
|---|---|---|
| Donor | hotel@demo.com | also: restaurant@, bakery@, market@, cafeteria@, catering@ (`@demo.com`) |
| Receiver | kitchen@demo.com | also: ngo@, shelter@, foodbank@, orphanage@, greenplate@ |
| Admin | admin@demo.com | verifies new receivers, sees platform analytics |

The login page has one-click Donor / Receiver / Admin buttons.

## 2-minute demo script for the review

1. **Donor** → *Predictions*: 7-day forecast, expected quantity, time window, accuracy vs naive baseline.
2. **Donor** → *Post Surplus*: 20 kg cooked, 4 h → ranked receivers appear with match scores; they are notified.
3. Logout → **Receiver** (kitchen@demo.com) → *Notifications* / *Available Food* → **Accept** → **Mark picked up** → **Mark delivered**.
4. Back as **Donor** → *My Listings* → **Tracking** (full timeline) and *Notifications*.
5. **Admin** → *Analytics* (kg redistributed, meals, CO₂e, success rate), *Verify Receivers* (register a new receiver first), *Map*.

## Architecture (maps to Review 3 slides)

```
Browser (HTML/CSS/JS + Leaflet + OpenStreetMap)
        │  REST / JSON
        ▼
API Gateway  (src/gateway.js: security headers, rate limiting, token auth, routing)
   ├─ User Service          src/users.js          register, login, roles, receiver verification
   ├─ Surplus Registration  src/surplus.js        post food, accept/pickup/deliver/cancel
   ├─ Prediction Engine     src/prediction.js     ML forecasting + back-testing + early alerts
   ├─ Matching & Allocation src/matching.js       hyperlocal ranking
   ├─ Notification Service  src/notifications.js
   ├─ Tracking Service      (events in surplus.js) full status timeline
   └─ Analytics Dashboard   src/analytics.js
Datastore: src/db.js (embedded JSON file; swap for PostgreSQL later)
```

Each service is a separate module with its own functions, so it can be split into its own container later.

### Prediction (ML)
Ensemble time-series model: recency-weighted day-of-week mean (70%) + exponential moving average (30%).
Accuracy is measured by rolling back-testing on the last 14 days (shown in the UI) and compared with a "same as yesterday" baseline.
Every surplus posted on the platform is added to the history, so the model keeps learning.
When a big surplus is expected tomorrow, matched receivers get an early notification.

### Matching
Hard filters: receiver verified, accepts the food type, capacity ≥ quantity, within the receiver's radius, reachable before expiry.
Score (0–100): proximity, capacity fit, pickup-window availability, time slack. Weights shift toward proximity and time slack as expiry gets closer.

### Security (feedback from Review 1)
scrypt password hashing, HMAC-signed expiring tokens, role-based access control, input validation, per-IP rate limiting, security headers, HTML-escaped output.

## Deploy on Kubernetes (Docker + Helm + Minikube)

Install once: Docker Desktop, [minikube](https://minikube.sigs.k8s.io/docs/start/), kubectl, [helm](https://helm.sh/docs/intro/install/). Start Docker Desktop, then:

- **Windows:** double-click `k8s\deploy-minikube.bat`
- **Mac/Linux:** `./k8s/deploy-minikube.sh`

Or step by step from the project folder:

```
minikube start --driver=docker
minikube image build -t foodbridge:1.0 .
helm upgrade --install foodbridge helm/foodbridge
kubectl get pods
minikube service foodbridge-foodbridge
```

The last command opens the app in your browser (keep that terminal open). Useful extras: `kubectl logs deploy/foodbridge-foodbridge`, `helm list`, `helm uninstall foodbridge`, `minikube dashboard`.

Note: the datastore is a single file, so the chart runs 1 replica. Moving to PostgreSQL would allow scaling out (`replicaCount` in `values.yaml`).

## Deploy to the cloud (Render free tier)

1. Push this folder to a GitHub repo.
2. On https://render.com → **New → Blueprint** → select the repo (uses `render.yaml`).
3. Wait for the build; open the URL it gives you.
   (Free tier storage is temporary: demo data is re-created when the service restarts.)

Docker: `docker build -t foodbridge . && docker run -p 3000:3000 foodbridge`
