import type { DcqlClaim, DcqlQuery } from './types';

export function buildDcqlQuery(input: {
  credentialId: string;
  vctValues: string[];
  claims: DcqlClaim[];
}): DcqlQuery {
  return {
    credentials: [
      {
        id: input.credentialId,
        format: 'dc+sd-jwt',
        meta: {
          vct_values: input.vctValues
        },
        claims: input.claims
      }
    ]
  };
}
