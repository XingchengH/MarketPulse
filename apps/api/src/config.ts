import { z } from 'zod';

const optionalCredential = z.string().trim().default('');

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().max(65_535).default(3000),
    WEB_ORIGIN: z.string().url(),
    MONGODB_URI: z.string().min(1),
    GOOGLE_CLIENT_ID: optionalCredential,
    GOOGLE_CLIENT_SECRET: optionalCredential,
    GOOGLE_REDIRECT_URI: optionalCredential,
    ALPACA_API_KEY: optionalCredential,
    ALPACA_API_SECRET: optionalCredential,
    ACCESS_TOKEN_SECRET: z.string().min(1),
    REFRESH_TOKEN_PEPPER: z.string().min(1),
  })
  .superRefine((value, context) => {
    if (value.GOOGLE_REDIRECT_URI) {
      const parsed = z.string().url().safeParse(value.GOOGLE_REDIRECT_URI);
      if (!parsed.success) {
        context.addIssue({
          code: 'custom',
          path: ['GOOGLE_REDIRECT_URI'],
          message: 'GOOGLE_REDIRECT_URI must be a valid URL',
        });
      }
    }

    if (value.NODE_ENV !== 'production') return;

    for (const field of ['ACCESS_TOKEN_SECRET', 'REFRESH_TOKEN_PEPPER'] as const) {
      if (value[field].length < 32 || value[field].trim().length === 0) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} must be at least 32 characters in production`,
        });
      }
    }

    for (const field of [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REDIRECT_URI',
      'ALPACA_API_KEY',
      'ALPACA_API_SECRET',
    ] as const) {
      if (!value[field]) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} is required in production`,
        });
      }
    }
  });

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  webOrigin: string;
  mongodbUri: string;
  google: { clientId: string; clientSecret: string; redirectUri: string };
  alpaca: { apiKey: string; apiSecret: string };
  accessTokenSecret: string;
  refreshTokenPepper: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = environmentSchema.parse(env);
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    webOrigin: parsed.WEB_ORIGIN,
    mongodbUri: parsed.MONGODB_URI,
    google: {
      clientId: parsed.GOOGLE_CLIENT_ID,
      clientSecret: parsed.GOOGLE_CLIENT_SECRET,
      redirectUri: parsed.GOOGLE_REDIRECT_URI,
    },
    alpaca: { apiKey: parsed.ALPACA_API_KEY, apiSecret: parsed.ALPACA_API_SECRET },
    accessTokenSecret: parsed.ACCESS_TOKEN_SECRET,
    refreshTokenPepper: parsed.REFRESH_TOKEN_PEPPER,
  };
}
