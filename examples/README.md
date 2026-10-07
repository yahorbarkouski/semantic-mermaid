# Examples

Each example is a Mermaid source file with Semantic Mermaid directives, next to a PNG of how the semantic layout draws it. GitHub and other Mermaid hosts draw these sources with their own layout, which ignores the directives, so the PNGs show what the engine does. Regenerate them with `npm run images`.

## [order.mmd](order.mmd): main path, exit, retry, side box

`@main`, `@exit B -> X`, `@retry G -> D`, `@side R`. The order flow runs in one column, the rejection sits beside the payment decision, and the fraud rules sit beside the decision they feed.

![The order flow drawn by the semantic layout](order.png)

## [sign-in.mmd](sign-in.mmd): swimlanes, top-down

`@lanes UA SP IdP` with a retry back to the first step. A SAML sign-in passes between the browser, the service provider and the identity provider, one lane each, with time running down.

![A SAML sign-in in three lanes](sign-in.png)

## [onboarding.mmd](onboarding.mmd): swimlanes, left-to-right

`@lanes EMP HR IT`. In a left-to-right diagram the lanes are rows and time runs right.

![Employee onboarding in three horizontal lanes](onboarding.png)

## [incident.mmd](incident.mmd): side groups

`@side Signals Playbooks`. Each group of references sits beside the step it feeds.

![An incident process with two reference groups beside the main path](incident.png)

## [gateway.mmd](gateway.mmd): exits off a straight row

Four `@exit` arrows. The request path is one row, and the rejections drop below it.

![An API gateway with four rejections below the request path](gateway.png)

## [pipeline.mmd](pipeline.mmd): a side input

`@side dir`. The engine's own pipeline, used in the main README.

![The semantic engine's pipeline](pipeline.png)
