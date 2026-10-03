# DevPilot

DevPilot is a portfolio-grade AI developer assistant for exploring **public GitHub repositories**, asking repository-aware questions, reviewing code, and drafting test suggestions. It is a full-stack TypeScript application; repository source is fetched from GitHub and is never executed.

## Features

- Email/password registration and login, bcrypt password hashes, JWT authentication in an HttpOnly cookie, protected API routes, and logout.
- Connect and browse public GitHub repositories, their trees, and bounded text-file previews.
- Persistent general and repository-associated conversations.
- Repository-aware chat with bounded GitHub context and optional semantic retrieval over indexed chunks.
- Optional repository indexing with deterministic source chunking, embeddings, and MongoDB Atlas Vector Search.
- Structured AI code-analysis findings with source paths, uncertainty, and suggestions.
- Generated test-code suggestions for supported JavaScript/TypeScript (Vitest) and Python (pytest) repositories. Suggestions are not executed and are not represented as passing tests.
- Explicit provider-unavailable/error states, request validation, ownership checks, CSRF-origin checks, and bounded per-process rate limits.

Only public GitHub repositories are supported. DevPilot does not execute repository or generated code.

## Architecture

```text
Browser (React / Vite / TypeScript)
  | HTTPS, credentialed API requests (HttpOnly auth cookie)
  v
Vercel static frontend  --->  Render Node.js / Express API
                                      |             |
                                      v             v
                              MongoDB Atlas    Public GitHub API
                                      |
                           Atlas Vector Search
                                      ^
                                      |
                            Gemini (server only)
```

The API owns authentication, GitHub access, persistence, indexing, retrieval, and AI-provider calls. `GEMINI_API_KEY` is read only by the backend; it must never be placed in a `VITE_*` variable or frontend bundle.

## Technology

- Client: React, React Router, Vite, TypeScript, Tailwind CSS.
- Server: Node.js, Express, TypeScript, Zod, Mongoose.
- Persistence: MongoDB/Mongoose for users, repositories, conversations, messages, and repository chunks.
- Integrations: public GitHub API and a server-side Gemini provider. Embeddings use a separate provider interface from chat.
- Tests: Vitest, Supertest, MongoDB Memory Server, and React Testing Library.

## Authentication and repository security

Passwords are hashed with bcrypt. The server signs JWTs using `JWT_SECRET` and sets them in an HttpOnly cookie. Production cookies are Secure and `SameSite=None` for cross-origin frontend/API requests; unsafe API requests are restricted to the configured frontend origin and checked against Fetch Metadata. Set `FRONTEND_URL` to the exact deployed frontend origin, without a trailing slash.

Repository, conversation, message, index, and retrieval operations are scoped to the authenticated user. GitHub integration accepts public owner/repository names and does not request or store a GitHub personal access token. Repository content and model responses are untrusted data; content is bounded and is not executed or rendered as arbitrary HTML.

## Repository retrieval and indexing

Repository chat retains the Phase 9 deterministic, bounded GitHub retrieval path. Indexing discovers files through GitHub, filters unsupported/binary/generated content, chunks supported source deterministically, and stages a versioned index before activating it. Failed indexing does not replace the last active index. Indexing is triggered explicitly and does not block application startup.

When Gemini embeddings and a compatible Atlas Vector Search index are available, retrieval uses semantic similarity plus deterministic path/name signals. Vector queries are filtered by the authenticated user, repository, and active index version. If embedding or Atlas vector search is unavailable, the application falls back to bounded GitHub retrieval; this fallback is not semantic search.

### Configure the Atlas vector index

Create a MongoDB Atlas Vector Search index on the Mongoose `repositorychunks` collection (in the database named by `MONGODB_URI`). The default index name is `devpilot_repository_chunks`; if you choose another name, set `ATLAS_VECTOR_INDEX_NAME` to match it.

Use this Atlas Search index definition:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 768,
      "similarity": "cosine"
    },
    { "type": "filter", "path": "repositoryId" },
    { "type": "filter", "path": "userId" },
    { "type": "filter", "path": "indexVersion" }
  ]
}
```

The collection is created by MongoDB when the application first writes indexed chunks; create it before creating the vector index if necessary. Atlas Vector Search availability and this index definition have not been live-tested as part of local verification. Without the index, semantic retrieval is unavailable and the bounded GitHub fallback remains in use.

## Local setup

Requirements: Node.js 22 (the local verification environment used Node 22.16.0), npm, and MongoDB. Gemini is optional for starting the server; AI features require a valid server-side Gemini key. Semantic retrieval additionally requires Atlas Vector Search.

```powershell
npm ci
Copy-Item server\.env.example server\.env
Copy-Item client\.env.example client\.env.local
npm run dev
```

The client runs at `http://127.0.0.1:5173`; the API runs at `http://127.0.0.1:5000`. The API health endpoint is `http://127.0.0.1:5000/api/v1/health`. Ensure MongoDB is available at the `MONGODB_URI` in `server/.env`. Set `VITE_API_BASE_URL` in `client/.env.local` to the API origin, such as `http://127.0.0.1:5000`.

Do not commit `.env` files. The committed examples contain local sample values and placeholders only.

## Environment variables

Set backend variables in the server environment (locally, `server/.env`). The client variable belongs in `client/.env.local` or the Vercel frontend project settings.

| Variable | Required / default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development`; set `production` when deployed | Cookie/security behavior and production validation. |
| `PORT` | `5000`; Render supplies its port | HTTP listener. |
| `FRONTEND_URL` | `http://127.0.0.1:5173` | Exact allowed browser origin for credentialed CORS and unsafe-request origin validation. |
| `MONGODB_URI` | Local default in development; **required in production** | MongoDB connection string. |
| `JWT_SECRET` | Random process-local secret in development; **required in production**, minimum 32 characters | JWT signing secret. |
| `JWT_EXPIRES_IN` | `1d` | Token lifetime (`s`, `m`, `h`, or `d`). |
| `COOKIE_NAME` | `devpilot_token` | Authentication cookie name. |
| `GEMINI_API_KEY` | Optional at server startup | Enables Gemini chat, embeddings, analysis, and test suggestions. Keep backend-only. |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Gemini chat/analysis/test-generation model. |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-001` | Gemini embedding model; the provider outputs 768 dimensions. |
| `ATLAS_VECTOR_INDEX_NAME` | `devpilot_repository_chunks` | Atlas Search index name used for vector retrieval. |
| `MAX_REPOSITORY_FILE_SIZE_BYTES` | `1048576` | Maximum preview/indexed file size in bytes (schema ceiling 10 MiB). |
| `MAX_REPOSITORY_CONTEXT_FILES` | `6` | Maximum files in deterministic context retrieval (ceiling 12). |
| `MAX_REPOSITORY_CONTEXT_FILE_CHARS` | `10000` | Maximum characters from one deterministically retrieved file. |
| `MAX_REPOSITORY_CONTEXT_TOTAL_CHARS` | `24000` | Total characters in deterministic repository context. |
| `MAX_REPOSITORY_CONTEXT_TREE_ENTRIES` | `250` | Tree entries examined by deterministic retrieval. |
| `MAX_REPOSITORY_CONTEXT_DIRECTORY_DEPTH` | `3` | Maximum discovery depth. |
| `MAX_REPOSITORY_CONTEXT_TREE_REQUESTS` | `8` | Maximum GitHub directory requests for deterministic retrieval. |
| `MAX_REPOSITORY_INDEX_FILES` | `100` | Maximum source files in one indexing run (ceiling 500). |
| `MAX_REPOSITORY_INDEX_TREE_ENTRIES` | `2000` | Maximum tree entries examined for indexing. |
| `MAX_REPOSITORY_INDEX_TREE_REQUESTS` | `100` | Maximum GitHub directory requests for indexing. |
| `MAX_REPOSITORY_INDEX_TOTAL_CHARS` | `500000` | Maximum source characters indexed per run. |
| `MAX_REPOSITORY_CHUNK_CHARS` | `3000` | Maximum chunk size (ceiling 8000). |
| `MAX_REPOSITORY_RETRIEVED_CHUNKS` | `6` | Maximum chunks supplied by indexed retrieval (ceiling 20). |
| `MAX_REPOSITORY_RETRIEVAL_CHARS` | `24000` | Maximum total context characters from indexed retrieval. |
| `VITE_API_BASE_URL` | `http://127.0.0.1:5000` | Client build-time API origin. This is not a secret. |

All limit variables are parsed and bounded by the server; see `server/.env.example` for a copyable local template.

## Testing and quality checks

From the repository root:

```powershell
npm test --workspace server -- --maxWorkers=1
npm test --workspace client
npm run typecheck --workspace server
npm run build --workspace server
npm run typecheck --workspace client
npm run build --workspace client
npm run lint --workspace client
```

The backend tests use injected/mock AI and GitHub providers or in-memory MongoDB; they do not require a live Gemini key or Atlas cluster. The latest local QA pass completed **130 backend tests across 10 files** and **5 client tests across 1 file**. Backend and client typechecks/builds and client lint passed. The tests do not verify live GitHub, Gemini, production MongoDB, or Atlas Vector Search availability.

## Manual deployment

No deployment has been run. Deploy only after supplying your own provider accounts, secrets, database, and domains.

### 1. MongoDB Atlas

1. Create a cluster and database, then create a database user with only the permissions the application needs.
2. Restrict network access to the backend's supported egress IPs or private networking. Avoid opening the database to all addresses.
3. Set `MONGODB_URI` as a secret on the backend service. Confirm the URI's database name is the database where `repositorychunks` and the vector index will reside.
4. For semantic retrieval, create the `repositorychunks` vector index described above. Without a valid Atlas Vector Search index and Gemini embedding access, repository chat uses its bounded GitHub fallback.

### 2. Backend on Render

Create a Node web service using the repository root as the working directory (this is an npm-workspaces monorepo):

- Build command: `npm ci --include=dev && npm run build --workspace server`
- Start command: `npm run start --workspace server`
- Health check path: `/api/v1/health`
- Use a current Node 22 runtime.

Set `NODE_ENV=production`, `MONGODB_URI`, a cryptographically random `JWT_SECRET` of at least 32 characters, and `FRONTEND_URL` to the exact deployed frontend origin. Set `GEMINI_API_KEY` to enable AI features; `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL`, and `ATLAS_VECTOR_INDEX_NAME` may be set when customizing their defaults. Add bounded indexing/retrieval variables only if the defaults need adjustment. Do not put secrets in source control or client settings.

The server must connect to MongoDB before it starts listening. The health endpoint reports the API and current MongoDB connection status; it is not a separate Atlas Vector Search readiness check. Render's `PORT` is honored by the server.

### 3. Frontend on Vercel

Create a project from the same repository with the repository root as the project root. The committed [`vercel.json`](./vercel.json) uses the root npm lockfile, builds only the client workspace, publishes `client/dist`, and rewrites client-side routes to the SPA entry point. Set:

- Node.js runtime: 22.x
- Environment variable: `VITE_API_BASE_URL` set to the Render API origin (for example, `https://<your-service>.onrender.com`), with no `/api/v1` suffix.

Redeploy after changing `VITE_API_BASE_URL`; Vite embeds this value at build time.

### 4. Cross-origin cookies and production checks

The frontend and API must use HTTPS. The API uses an HttpOnly, Secure, `SameSite=None` cookie in production and permits only the exact `FRONTEND_URL` origin for credentialed CORS and unsafe requests. Separate default Vercel and Render domains are cross-site, and some browsers restrict third-party cookies. For a reliable browser experience, use frontend and API custom domains under the same registrable domain (for example, `app.example.com` and `api.example.com`), and set `FRONTEND_URL` and `VITE_API_BASE_URL` to those deployed origins. Configure the production CORS origin exactly; Vercel preview origins are not automatically trusted.

After deployment, verify the health endpoint, user registration/login/logout, repository ownership and browsing, chat/provider-unavailable behavior, indexing status, analysis/test suggestions, and browser cookie behavior. Test semantic retrieval only after Atlas shows the vector index as ready and a repository has been indexed with embeddings.

## Known limitations and future work

- Only public GitHub repositories are supported; there is no GitHub OAuth or private-repository token integration.
- AI output can be incorrect. Analysis distinguishes findings from suggestions/uncertainty, and generated tests are suggestions only; neither is run automatically.
- Repository indexing is bounded and explicit, not a background job queue or continuous GitHub sync.
- Atlas Vector Search and live Gemini embedding/chat calls were not available for local QA. The configured index must be created and externally verified before claiming semantic retrieval works in production.
- Rate limits are bounded in-memory per backend process, not shared across replicas. A multi-instance deployment should use a shared limiter or an upstream gateway policy.
- Cross-site cookie behavior varies by browser; custom domains under one registrable domain are recommended for production.
- Future work could add a shared distributed rate limiter, a durable indexing queue, repository-refresh/webhook support, private repositories with least-privilege OAuth, and deployment-backed end-to-end monitoring.
