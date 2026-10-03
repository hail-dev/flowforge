import { z } from "zod";

// Node configs, per type

const triggerConfigSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("webhook") }),
    z.object({
        kind: z.literal("cron"),
        expression: z.string().min(1), // standard cron syntax
    }),
]);

const conditionConfigSchema = z.object({
    // dot-path into payload, e.g. "amount" or "customer.plan"
    field: z.string().min(1),
    operator: z.enum(["equals", "not_equals", "greater_than", "less_than", "contains"]),
    value: z.union([z.string(), z.number(), z.boolean()]),
});

const actionConfigSchema = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("http_request"),
        url: z.url(),
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        headers: z.record(z.string(), z.any()).optional(),
        body: z.record(z.string(), z.any()).optional(),
        retry: z.object({
            maxAttempts: z.number().int().min(1).max(5).default(1),
            backoffMs: z.number().int().min(100).max(60_000).default(1000),
        }).default({ maxAttempts: 1, backoffMs: 1000}),
    }),
]);

// nodes

const baseNodeFields = {
    id: z.string().min(1),
    position: z.object({ x: z.number(), y: z.number() }).optional(),
};

const triggerNodeSchema = z.object({
    ...baseNodeFields,
    type: z.literal("trigger"),
    config: triggerConfigSchema,
});

const conditionNodeSchema = z.object({
    ...baseNodeFields,
    type: z.literal("condition"),
    config: conditionConfigSchema,
});

const actionNodeSchema = z.object({
    ...baseNodeFields,
    type: z.literal("action"),
    config: actionConfigSchema
})

export const nodeSchema = z.discriminatedUnion("type", [
    triggerNodeSchema,
    conditionNodeSchema,
    actionNodeSchema,
]);

export type WorkflowNode = z.infer<typeof nodeSchema>;

// Edges

export const edgeSchema = z.object({
    source: z.string().min(1),
    target: z.string().min(1),
    branch: z.enum(["true", "false"]).optional(), // required only when source is a condition node
});

export type WorkflowEdge = z.infer<typeof edgeSchema>;

// whole workflow definition

export const workflowDefinitionSchema = z.object({
    nodes: z.array(nodeSchema).min(1),
    edges: z.array(edgeSchema),
});

export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

