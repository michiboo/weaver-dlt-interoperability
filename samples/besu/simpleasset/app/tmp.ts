import * as assetManager from "@hyperledger-labs/weaver-besu-interop-sdk/src/AssetManager";
import { Hash, SHA256 } from "@hyperledger-labs/weaver-besu-interop-sdk/src/HashFunctions";
const networkHost1 = "localhost"
const networkPort1 = "8545"
const networkHost2 = "localhost"
const networkPort2 = "9544"
const Web3 = require("web3")
const crypto = require("crypto")
const contract = require("@truffle/contract");
const path = require('path')
const fs = require('fs')
const provider1 = new Web3.providers.HttpProvider('http://' + networkHost1 + ':' + networkPort1)
const provider2 = new Web3.providers.HttpProvider('http://' + networkHost2 + ':' + networkPort2)
let timeOut = 15
let timeLockSeconds = Math.floor(Date.now() / 1000) + 2 * timeOut
let interopContract1:any
let interopContract2:any
let AliceERC20:any 
let BobERC20:any


async function main(){
const web3N1 = new Web3(provider1)
const accounts1 = await web3N1.eth.getAccounts()
const Alice1 = accounts1[1] // owner of AliceERC20 and wants swap for BobERC20
const Bob1 = accounts1[2] // owner of BobERC20 and wants to swap for AliceERC20
const contractOwner1 = accounts1[0] // owner of all the minted tokens when the contract was created, given how truffleconfig.js is composed

console.log("Alice address in Network 1", Alice1)
console.log("Bob address in Network 1", Bob1)

// Network 2
const provider2 = new Web3.providers.HttpProvider('http://' + networkHost2 + ':' + networkPort2)
const web3N2 = new Web3(provider2)
const accounts2 = await web3N2.eth.getAccounts()

const Alice2 = accounts2[1] // owner of AliceERC20 and wants swap for BobERC20
const Bob2 = accounts2[2] // owner of BobERC20 and wants to swap for AliceERC20
console.log("Alice address in Network 2", Alice2)
console.log("Bob address in Network 2", Bob2)

const contractOwner2 = accounts2[0] // owner of all the minted tokens when the contract was created, given how truffleconfig.js is composed

// Initialization
const tokenSupply = 1000
const tokenAmount = 10 // Number of tokens to be exchanged
const tokenId = 1;
const senderInitialBalance = tokenAmount

async function getBalances(Alice1: string, Bob1: string, Alice2: string, Bob2: string) {
	var AliceAliceERC20Balance = await AliceERC20.balanceOf(Alice1)
	console.log("Alice balance of AliceERC20 in Network 1", AliceAliceERC20Balance.toString())

	var BobAliceERC20Balance = await AliceERC20.balanceOf(Bob1)
	console.log("Bob balance of AliceERC20 in Network 1", BobAliceERC20Balance.toString())

	var AliceBobERC20Balance = await BobERC20.balanceOf(Alice2)
	console.log("Alice balance of BobERC20 in Network 2", AliceBobERC20Balance.toString())

	var BobBobERC20Balance = await BobERC20.balanceOf(Bob2)
	console.log("Bob balance of BobERC20 in Network 2", BobBobERC20Balance.toString())
}


await init(provider1, provider2, contractOwner1, contractOwner2, Alice1, Bob2, tokenSupply, senderInitialBalance)

async function getContractInstance(provider: any, pathToJson: string) {
	const jsonFile = path.resolve(__dirname, pathToJson)
	var jsonFileContents = fs.readFileSync(jsonFile)
	var contractName = contract(JSON.parse(jsonFileContents))
	contractName.setProvider(provider)
	var instance = await contractName.deployed().catch(function () {
		console.log("Failed getting the contractName!");
	})
	return instance
}
// Initialization of the parameters
async function init(provider1: any, provider2: any, contractOwner1:any, contractOwner2:any, Alice1:any, Bob2:any, tokenSupply: number, senderInitialBalance: number) {
	interopContract1 = await getContractInstance(provider1, '../build/contracts/AssetExchangeContract.json').catch(function () {
		console.log("Failed getting interopContract1!");
	})
	interopContract2 = await getContractInstance(provider2, '../build/contracts/AssetExchangeContract.json').catch(function () {
		console.log("Failed getting interopContract2!");
	})

	AliceERC20 = await getContractInstance(provider1, '../build/contracts/AliceERC20.json').catch(function () {
		console.log("Failed getting AliceERC20 token contract!");
	})
	BobERC20 = await getContractInstance(provider2, '../build/contracts/BobERC20.json').catch(function () {
		console.log("Failed getting BobERC20 token contract!");
	})

	// Issue AliceERC20 tokens to Alice in Network 1 and BobERC20 tokens 
	// to Bob in Network 2. A minimal number of tokens equal to the 
	// number of token being exchanged is issued to Alice and Bob to 
	// ensure that the exchange in this test application does not fail 
	// due to insufficient funds.
	await AliceERC20.transfer(Alice1, senderInitialBalance, { from: contractOwner1 }).catch(function () {
		console.log("AliceERC20 transfer threw an error; Probably the token supply is used up!");
	})
	await BobERC20.transfer(Bob2, senderInitialBalance, { from: contractOwner2 }).catch(function () {
		console.log("BobERC20 transfer threw an error; Probably the token supply is used up!");
	})
}
console.log("\n Beginning:")
await getBalances(Alice1, Bob1, Alice2, Bob2)
var res = await assetManager.createHTLC(
    interopContract1,
    AliceERC20,
    "1",
    "1",
    1,
    Alice1,
    Bob1,
    timeLockSeconds
)
console.log("\n Balances after creating Alice locks his tokens in Network 1:")
await getBalances(Alice1, Bob1, Alice2, Bob2)
let lockContractId1 = res.result.logs[0].args.lockContractId
console.log("final :", Buffer.from(res.hash?.getPreimage()).toString('hex'))
await assetManager.claimAssetInHTLC(lockContractId1, interopContract1, Bob1, res.hash?.getPreimage())
console.log("\n Balances after claim Network:")
await getBalances(Alice1, Bob1, Alice2, Bob2)
console.log("\n test unlock")
var res1 = await assetManager.createHTLC(
    interopContract1,
    AliceERC20,
    "1",
    "1",
    1,
    Alice1,
    Bob1,
    Math.floor(Date.now() / 1000) + 5
)
await getBalances(Alice1, Bob1, Alice2, Bob2)
let lockContractId2 = res1.result.logs[0].args.lockContractId
function delay(ms: number) {
    return new Promise( resolve => setTimeout(resolve, ms) );
}

const lockStatus = await assetManager.isAssetLockedInHTLC(lockContractId2, interopContract1);
if (lockStatus !== true) throw new Error("asset not locked")
await delay(6000)

await assetManager.HTLCAssetUnlock(interopContract1,lockContractId2, Alice1)

console.log("--------------------unlocking---------------------")
await getBalances(Alice1, Bob1, Alice2, Bob2)
}
main()