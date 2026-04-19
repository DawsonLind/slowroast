## Decision: haiku > sonnet for image auditing
Date: 4/18/26
Context: haiku couldnt generate a summary of its image findings in a single prompt due to working memory constraints
Options considered: 
    - upgrade to sonnet for more context
    - return a simple hard-coded summary if haiku fails to generate summary
    - removed summary generation from first haiku call and create a second call dedicated to generating a summary
Chose: initially i tested upgrading the model to sonnet, but saw sonnet struggle too. i then decided that a second haiku call would be more reliable and 2 haiku calls still costs less than one sonnet call
Why: i didn't want to waste the findings of the initial haiku call and i wanted to maintain haiku for web scraping - sonnect for synthizing results
Tradeoffs: with the second haiku call approach, there is a chance that the inital call fails then the second call is simply wasted tokens.this is necessary waste as it is the only way to keep the catagories consistent for the sonnet synthizing step.