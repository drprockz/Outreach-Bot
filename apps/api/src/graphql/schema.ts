import { builder } from './builder.js'
import './resolvers/leads.js'
import './resolvers/me.js'
import './resolvers/orgs.js'
import './resolvers/admin.js'
import './resolvers/config.js'
import './resolvers/niches.js'
import './resolvers/offer.js'
import './resolvers/icpProfile.js'
import './resolvers/sequences.js'
import './resolvers/savedViews.js'
import './resolvers/engineGuardrails.js'

export const schema = builder.toSchema()
