// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SENTINAL — Config Schema
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { z } from 'zod'

export const configSchema = z.object({
    schedule: z.string(),
    oracleAddress: z.string(),
    chainSelector: z.string(),
    discordWebhookUrl: z.string().optional(),
    // Optional: second chain oracle for cross-chain propagation
    arbitrumOracleAddress: z.string().optional(),
    baseOracleAddress: z.string().optional(),
    protocols: z.array(
        z.object({
            name: z.string(),
            type: z.string(),
            poolAddress: z.string(),
            assetAddress: z.string(),
            chainName: z.string(),
            isTestnet: z.boolean(),
            decimals: z.number(),
            defiLlamaSlug: z.string(),
        })
    ),
})

export type Config = z.infer<typeof configSchema>
export type Protocol = Config['protocols'][0]