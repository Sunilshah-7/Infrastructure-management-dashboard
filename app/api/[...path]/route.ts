import { faker } from "@faker-js/faker";

import { createApiKey, generateApiKeys } from "@/mocks/data/api-keys";
import { generateAuditLogs } from "@/mocks/data/audit-logs";
import { generateBillingInvoices, generateBillingUsage } from "@/mocks/data/billing";
import { generateDeployments } from "@/mocks/data/deployments";
import { generateGpuMetrics, generateGpuSummary } from "@/mocks/data/gpu-metrics";
import {
  getLegacyProduct,
  getLegacyProducts,
  getLegacyUser,
  getLegacyUsers,
  getProductSales,
  getUserAnalytics,
} from "@/mocks/data/legacy-dashboard";
import { generateModels } from "@/mocks/data/model-registry";
import { generateMockCompletion } from "@/mocks/data/playground";
import { generateTeamMembers, getRolePermissions } from "@/mocks/data/teams";
import { createWebhook, generateWebhookDeliveries, generateWebhooks } from "@/mocks/data/webhooks";
import type {
  ApiKey,
  ApiKeyEnvironment,
  ApiKeyScope,
  ApiResponse,
  AuditLogEntry,
  DeploymentEnvironment,
  DeploymentLog,
  ModelDeployment,
  ModelStatus,
  ModelType,
  PaginatedResponse,
  Role,
  TeamMember,
  TimeRange,
  Webhook,
  WebhookDelivery,
  WebhookEvent,
} from "@/types/api";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    path?: string[];
  }>;
};

type RouteParams = Record<string, string | undefined>;

type RouteMatch = {
  pattern: string;
  params: RouteParams;
};

const models = generateModels(16);
const deployments = generateDeployments(24);
const teamMembers = generateTeamMembers(12);
const auditLogs = generateAuditLogs(64);
const billingUsage = generateBillingUsage();
const billingInvoices = generateBillingInvoices(12);
const apiKeys = generateApiKeys();
const webhooks = generateWebhooks();
const webhookDeliveries = generateWebhookDeliveries(webhooks);

const currentUser = {
  id: "user_admin",
  name: "Platform Admin",
  email: "admin@imd.ai",
};

const adminPermissions = getRolePermissions("admin");

function ok<T>(data: T, meta?: Record<string, unknown>): ApiResponse<T> {
  return {
    data,
    meta: {
      generatedAt: new Date().toISOString(),
      ...meta,
    },
    error: null,
  };
}

function json<T>(data: T, init?: ResponseInit) {
  return Response.json(data, init);
}

function jsonError(message: string, status: number, code: string) {
  return json(
    {
      data: null,
      error: {
        code,
        message,
      },
    },
    { status },
  );
}

function notFound(message = "API route not found") {
  return jsonError(message, 404, "not_found");
}

function methodNotAllowed() {
  return jsonError("Method not allowed", 405, "method_not_allowed");
}

function getSearchParam(request: Request, name: string) {
  return new URL(request.url).searchParams.get(name);
}

function getNumberParam(request: Request, name: string, fallback: number) {
  const value = Number(getSearchParam(request, name));

  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function paginate<T>(request: Request, items: T[]): PaginatedResponse<T> {
  const page = getNumberParam(request, "page", 1);
  const limit = getNumberParam(request, "limit", 20);
  const start = (page - 1) * limit;
  const data = items.slice(start, start + limit);

  return {
    data,
    meta: {
      page,
      limit,
      total: items.length,
      hasMore: start + limit < items.length,
      generatedAt: new Date().toISOString(),
    },
    error: null,
  };
}

function createInferenceMetrics() {
  faker.seed(2808);

  return Array.from({ length: 24 }, (_, index) => {
    const timestamp = new Date(Date.now() - (23 - index) * 60 * 60 * 1000).toISOString();
    const p50LatencyMs = faker.number.int({ min: 80, max: 180 });
    const p95LatencyMs = p50LatencyMs + faker.number.int({ min: 80, max: 260 });
    const p99LatencyMs = p95LatencyMs + faker.number.int({ min: 80, max: 420 });

    return {
      timestamp,
      requestsPerMinute: faker.number.int({ min: 12_000, max: 62_000 }),
      tokensPerSecond: faker.number.int({ min: 42_000, max: 240_000 }),
      p50LatencyMs,
      p95LatencyMs,
      p99LatencyMs,
      errorRatePercent: Number(faker.number.float({ min: 0.01, max: 1.8 }).toFixed(2)),
    };
  });
}

async function parseJsonBody<T>(request: Request): Promise<Partial<T>> {
  try {
    return (await request.json()) as Partial<T>;
  } catch {
    return {};
  }
}

function createDeploymentStream(logs: DeploymentLog[]) {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      logs.forEach((log, index) => {
        controller.enqueue(
          encoder.encode(`event: log\ndata: ${JSON.stringify({ index, ...log })}\n\n`),
        );
      });
      controller.enqueue(encoder.encode('event: done\ndata: {"ok":true}\n\n'));
      controller.close();
    },
  });
}

function matchPath(path: string, pattern: string): RouteMatch | null {
  const pathSegments = path.split("/").filter(Boolean);
  const patternSegments = pattern.split("/").filter(Boolean);

  if (pathSegments.length !== patternSegments.length) {
    return null;
  }

  const params: RouteParams = {};

  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index];
    const pathSegment = pathSegments[index];

    if (!patternSegment || !pathSegment) {
      return null;
    }

    if (patternSegment.startsWith(":")) {
      params[patternSegment.slice(1)] = pathSegment;
      continue;
    }

    if (patternSegment !== pathSegment) {
      return null;
    }
  }

  return { pattern, params };
}

async function handleGet(request: Request, path: string) {
  if (path === "health") {
    return json(ok({ status: "ok", service: "mock-api" }));
  }

  if (path === "auth/me") {
    return json(
      ok({
        user: currentUser,
        roles: ["admin"] satisfies Role[],
        permissions: adminPermissions,
      }),
    );
  }

  if (path === "metrics/gpu") {
    const range = (getSearchParam(request, "range") ?? "24h") as TimeRange;
    const intervalMinutes = getNumberParam(request, "intervalMinutes", 5);

    return json(ok(generateGpuMetrics({ range, intervalMinutes })));
  }

  if (path === "metrics/gpu/summary") {
    return json(ok(generateGpuSummary()));
  }

  if (path === "metrics/inference") {
    return json(ok(createInferenceMetrics()));
  }

  if (path === "models") {
    const status = getSearchParam(request, "status") as ModelStatus | null;
    const type = getSearchParam(request, "type") as ModelType | null;
    const query = getSearchParam(request, "q")?.toLowerCase();

    const filtered = models.filter((model) => {
      const matchesStatus = status ? model.status === status : true;
      const matchesType = type ? model.type === type : true;
      const matchesQuery = query
        ? model.name.toLowerCase().includes(query) ||
          model.description.toLowerCase().includes(query)
        : true;

      return matchesStatus && matchesType && matchesQuery;
    });

    return json(paginate(request, filtered));
  }

  const modelMatch = matchPath(path, "models/:id");

  if (modelMatch) {
    const model = models.find((item) => item.id === modelMatch.params.id);

    return model ? json(ok(model)) : notFound("Model not found");
  }

  if (path === "deployments") {
    const environment = getSearchParam(request, "environment") as DeploymentEnvironment | null;
    const status = getSearchParam(request, "status");
    const filtered = deployments.filter((deployment) => {
      return (
        (environment ? deployment.environment === environment : true) &&
        (status ? deployment.status === status : true)
      );
    });

    return json(paginate(request, filtered));
  }

  const deploymentLogMatch = matchPath(path, "deployments/:id/logs");

  if (deploymentLogMatch) {
    const deployment = deployments.find((item) => item.id === deploymentLogMatch.params.id);

    if (!deployment) {
      return notFound("Deployment not found");
    }

    return new Response(createDeploymentStream(deployment.logs), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  const deploymentMatch = matchPath(path, "deployments/:id");

  if (deploymentMatch) {
    const deployment = deployments.find((item) => item.id === deploymentMatch.params.id);

    return deployment ? json(ok(deployment)) : notFound("Deployment not found");
  }

  if (path === "teams") {
    return json(paginate(request, teamMembers));
  }

  if (path === "audit-logs") {
    const action = getSearchParam(request, "action");
    const filtered = action ? auditLogs.filter((entry) => entry.action === action) : auditLogs;

    return json(paginate<AuditLogEntry>(request, filtered));
  }

  if (path === "billing/usage") {
    return json(ok(billingUsage));
  }

  if (path === "billing/invoices") {
    return json(paginate(request, billingInvoices));
  }

  if (path === "api-keys") {
    return json(paginate<ApiKey>(request, apiKeys));
  }

  if (path === "webhooks") {
    return json(paginate<Webhook>(request, webhooks));
  }

  if (path === "webhooks/deliveries") {
    return json(paginate<WebhookDelivery>(request, webhookDeliveries));
  }

  if (path === "legacy/user-analytics") {
    return json(ok(getUserAnalytics()));
  }

  if (path === "legacy/product-sales") {
    return json(ok(getProductSales()));
  }

  if (path === "legacy/users") {
    const users = getLegacyUsers();

    return json(ok(users, { total: users.length }));
  }

  const legacyUserMatch = matchPath(path, "legacy/users/:userId");

  if (legacyUserMatch) {
    const user = getLegacyUser(legacyUserMatch.params.userId ?? "");

    return user ? json(ok(user)) : notFound("User not found");
  }

  if (path === "legacy/products") {
    const products = getLegacyProducts();

    return json(ok(products, { total: products.length }));
  }

  const legacyProductMatch = matchPath(path, "legacy/products/:productId");

  if (legacyProductMatch) {
    const product = getLegacyProduct(legacyProductMatch.params.productId ?? "");

    return product ? json(ok(product)) : notFound("Product not found");
  }

  return notFound();
}

async function handlePost(request: Request, path: string) {
  if (path === "auth/login") {
    const body = await parseJsonBody<{ email: string }>(request);

    return json(
      ok({
        user: {
          ...currentUser,
          email: body.email ?? currentUser.email,
        },
        roles: ["admin"] satisfies Role[],
        permissions: adminPermissions,
        token: "mock-session-token",
      }),
    );
  }

  if (path === "auth/logout") {
    return json(ok({ success: true }));
  }

  const deployModelMatch = matchPath(path, "models/:id/deploy");

  if (deployModelMatch) {
    const model = models.find((item) => item.id === deployModelMatch.params.id);

    if (!model) {
      return notFound("Model not found");
    }

    const body = await parseJsonBody<{
      environment: DeploymentEnvironment;
      versionId: string;
      replicas: number;
    }>(request);
    const latestVersion = model.versions.at(-1);

    if (!latestVersion) {
      return jsonError("Model has no deployable versions", 422, "missing_model_version");
    }

    const deployment: ModelDeployment = {
      id: `${model.id}_${body.environment ?? "staging"}_${Date.now()}`,
      modelId: model.id,
      modelVersionId: body.versionId ?? latestVersion.id,
      environment: body.environment ?? "staging",
      status: "deploying",
      endpointUrl: `https://${body.environment ?? "staging"}.api.imd.ai/models/${model.id}`,
      replicas: body.replicas ?? 2,
      lastDeployedAt: new Date().toISOString(),
    };

    model.deployments.unshift(deployment);

    return json(ok(deployment), { status: 202 });
  }

  if (path === "teams/invite") {
    const body = await parseJsonBody<{ email: string; role: Role; name: string }>(request);
    const role = body.role ?? "viewer";
    const member: TeamMember = {
      id: `team_member_${teamMembers.length + 1}`,
      name: body.name ?? String(body.email ?? "Invited User").split("@")[0] ?? "Invited User",
      email: body.email ?? "invited@imd.ai",
      role,
      permissions: getRolePermissions(role),
      status: "invited",
      createdAt: new Date().toISOString(),
    };

    teamMembers.unshift(member);

    return json(ok(member), { status: 201 });
  }

  if (path === "api-keys") {
    const body = await parseJsonBody<{
      name: string;
      environment: ApiKeyEnvironment;
      scopes: ApiKeyScope[];
      expiresAt: string;
    }>(request);
    const created = createApiKey(body);

    apiKeys.unshift(created.apiKey);

    return json(ok(created), { status: 201 });
  }

  if (path === "webhooks") {
    const body = await parseJsonBody<{
      name: string;
      url: string;
      events: WebhookEvent[];
    }>(request);
    const created = createWebhook(body);

    webhooks.unshift(created.webhook);

    return json(ok(created), { status: 201 });
  }

  if (path === "playground/completion") {
    const body = await parseJsonBody<{ prompt: string }>(request);

    return json(ok(generateMockCompletion(body.prompt ?? "")));
  }

  return notFound();
}

async function handlePatch(request: Request, path: string) {
  const updateRoleMatch = matchPath(path, "teams/:id/role");

  if (updateRoleMatch) {
    const member = teamMembers.find((item) => item.id === updateRoleMatch.params.id);

    if (!member) {
      return notFound("Team member not found");
    }

    const body = await parseJsonBody<{ role: Role }>(request);
    const role = body.role ?? member.role;

    member.role = role;
    member.permissions = getRolePermissions(role);

    return json(ok(member));
  }

  const revokeApiKeyMatch = matchPath(path, "api-keys/:id/revoke");

  if (revokeApiKeyMatch) {
    const apiKey = apiKeys.find((item) => item.id === revokeApiKeyMatch.params.id);

    if (!apiKey) {
      return notFound("API key not found");
    }

    apiKey.status = "revoked";
    apiKey.revokedAt = new Date().toISOString();

    return json(ok(apiKey));
  }

  return notFound();
}

async function resolvePath(context: RouteContext) {
  const params = await context.params;

  return (params.path ?? []).join("/");
}

export async function GET(request: Request, context: RouteContext) {
  return handleGet(request, await resolvePath(context));
}

export async function POST(request: Request, context: RouteContext) {
  return handlePost(request, await resolvePath(context));
}

export async function PATCH(request: Request, context: RouteContext) {
  return handlePatch(request, await resolvePath(context));
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "GET, POST, PATCH, OPTIONS",
    },
  });
}

export async function PUT() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}
