# SignZero
serverless on-chain petition dapp

## Problem:
Nearly everything we do on-chain carries with it a financial aspect: ownership of assets as a default, voting mechanisms skewed towards whales and economically incentivized participation with weak retention. Social media and web2 instruments on the other hand are prone to abuse: gaming, sibyl attacks and botting.
Current ways of polling an issue or measuring a sentiment on- or off-chain, or a hybrid approach are all vulnerable to this to a bigger or lesser degree.

## Solution:
We propose a simple mechanism that takes away the financial aspect of on-chain participation completely, the **only** expense being the 0.1A MBR cost of a single opt-in transaction, at the same time being protected against sibyl, gaming and botting to a large degree.

## How does it work:
Petition author deploys application with optional eligibility flags, such as asa balance, algo balance, nfd.

*We can not access historical state of accounts with the smart contract, but we can leverage the rich history of Algorand for this. For example, Pera governance nfts can be fairly used to assess the amount of time the account owner has been active in the ecosystem.*

Petition author uses box storage to store the petition letter and sets a duration for the petition in rounds. For example 250,000 rounds, which is about a week.

Upon deployment the smart contract mints an ASA with the petition title as `name` and `0` `supply`.

*and here is the schtick of it: a zero supply ASA can not be owned by anyone, not even by its creator, just as an idea can not be owned by anyone, nor its creator, but both can be "owned" by a multitude.*


The signing of the petition is an opt-in transaction to said ASA. Just as an idea, a thought, it is matterless, intangible, and at the same time completely accesible and the support of it by community members is verifiable, since the supporter holds the zero amount of said ASA in their account together with the 0.1 MBR

Of course, anyone can opt-in to an ASA bypassing the frontend and the eligibility criteria. For that reason, when the petition ends, we could use an off-chain script, for final verification, substracting those ineligible accounts from total.

Anyone can call for the end of the petition, as long as its assigned number of rounds has passed, and to add a little flair, the lucky caller will receive a small symbolic sum og Algo, that is left there by the author and the unused app budget.

In its final state, the application makes a configuration operation on the petition ASA, inserting final count of signatures and removing the manager account, leaving it immutable, ownerless, but owned by everybody.

A user can choose to keep the opt-ins for the petitions they participated in, as a resume of opinions, or opt-out. The work is done.

## Conclusion

A lightweight, non-binding expression of opinions, removed from financial gratification and protected against attacks, to help gauge the sentiment of a community, poll an issue or rally the troops, this app hopes to be a useful addition to existing dao tooling, voting engines and drop mechanics.

Sign Zero.