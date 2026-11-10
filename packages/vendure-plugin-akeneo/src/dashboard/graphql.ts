import { graphql as dashboardGraphql } from '@vendure/dashboard';

// Types only, from the dev server's generated schema, which includes this plugin's API. Type
// imports are erased when the host project builds the dashboard, so the published package needs
// neither the dev server nor `gql.tada` in the host project: at runtime this is the dashboard's
// own `graphql`.
import type { graphql as devServerGraphql } from '../../dev-server/gql/graphql';

export type { ResultOf } from '@vendure/dashboard';

export const graphql = dashboardGraphql as unknown as typeof devServerGraphql;
