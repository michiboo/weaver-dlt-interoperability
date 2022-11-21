// * SPDX-License-Identifier: Apache-2.0
// */

/**
* This file provides helper functions for interoperability operations.
**/
/** End file docs */
import log4js from "log4js";
import assetLocksPb from "@hyperledger-labs/weaver-protos-js/common/asset_locks_pb";
import Web3 from 'web3';
import crypto from "crypto";
import { Hash, SHA256 } from "./HashFunctions";
var Contract = require('web3-eth-contract');
const logger = log4js.getLogger("InteroperableHelper");

// Create an asset exchange agreement structure
function createAssetExchangeAgreementSerialized(assetType: string, assetID: string, recipientECert: string, lockerECert: string) {
    const assetExchangeAgreement = new assetLocksPb.AssetExchangeAgreement();
    assetExchangeAgreement.setType(assetType);
    assetExchangeAgreement.setId(assetID);
    assetExchangeAgreement.setRecipient(recipientECert);
    assetExchangeAgreement.setLocker(lockerECert);
    return Buffer.from(assetExchangeAgreement.serializeBinary())
}

// Create an asset claim structure
function createAssetClaimInfoSerialized(hash: Hash) {
    const claimInfoHTLC = new assetLocksPb.AssetClaimHTLC();
    claimInfoHTLC.setHashmechanism(hash.HASH_MECHANISM);
    claimInfoHTLC.setHashpreimagebase64(Buffer.from(hash.getSerializedPreimageBase64()));
    const claimInfoHTLCSerialized = claimInfoHTLC.serializeBinary();
    const claimInfo = new assetLocksPb.AssetClaim();
    claimInfo.setLockmechanism(assetLocksPb.LockMechanism.HTLC);
    claimInfo.setClaiminfo(claimInfoHTLCSerialized);
    return Buffer.from(claimInfo.serializeBinary())
}

const createHTLC = async (
    assetManagerContract: any,
    tokenContract: any,
    assetID: string,
    assetData: string,
    assetAmount: number,
    senderAddress: string,
    recipientAddress: string,
    expiryTimeSecs: number,
): Promise<{ hash: Hash|null; result: any }> => {

    if (!assetManagerContract) {
        console.log("Contract handle not supplied");
        return { hash: null, result: false };
    }
    if (!assetID) {
        console.log("Asset ID not supplied");
        return { hash: null, result: false };
    }
    if (!recipientAddress) {
        console.log(`Recipient address not supplied ${recipientAddress}`);
        return { hash: null, result: false };
    }
    const currTimeSecs = Math.floor(Date.now() / 1000);   // Convert epoch milliseconds to seconds
    if (expiryTimeSecs <= currTimeSecs) {
        console.log("Supplied expiry time invalid or in the past: %s; current time: %s", new Date(expiryTimeSecs).toISOString(), new Date(currTimeSecs).toISOString());
        return { hash: null, result: false };
    }    

    const preimage = crypto.randomBytes(32) // to sample a preimage for the hash
	const newHash = crypto.createHash('sha256').update(preimage).digest()
	

    // const web3N1 = new Web3(provider);
    // Contract.setProvider(provider);
    const protobufParams = createAssetExchangeAgreementSerialized("", assetID, recipientAddress.slice(2), assetData);
    await tokenContract.approve(tokenContract.address, assetAmount, { from: senderAddress }).catch(function () {
        console.log("Token approval failed!!!");
        return false
    })

    // Normal invoke function
    var lockStatus = await assetManagerContract.lockAsset(
        protobufParams,
        tokenContract.address,
        assetAmount,
        newHash,
        expiryTimeSecs,
        Web3.utils.utf8ToHex(assetData),
        {
            from: senderAddress
        }
    ).catch(function (e:any) {
        console.log(e);
        console.log("lockAsset threw an error");
        lockStatus = false
    })
    const resHash = new SHA256()
    resHash.setPreimage(preimage)
    resHash.computeHash()
    console.log("Hash created 2: %o", resHash.getPreimage())
    return { hash : resHash, result: lockStatus };
};

/**
 * Latter step of a Hashed Time Lock Contract
 * - Claim a unique asset instance using a hash preimage
 **/
const claimAssetInHTLC = async (
    lockContractId: string,
    assetManagerContract: any,
    senderAddress: string,
    preimage: Buffer,
): Promise<any> => {

    if (!assetManagerContract) {
        console.log("Contract Address not supplied");
        return false;
    }
    
    const hash = new SHA256()
    hash.setPreimage(preimage)
    const claimInfoStr = createAssetClaimInfoSerialized(hash);
    // Normal invoke function
    var claimStatus = await assetManagerContract.claimAsset(lockContractId, claimInfoStr, {from: senderAddress}).catch(function (e: any) {
        console.log(e)
        console.log("claimAsset threw an error");
        claimStatus = false
    })

    return claimStatus;
};

export {
    createAssetExchangeAgreementSerialized,
    createAssetClaimInfoSerialized,
    createHTLC,
    claimAssetInHTLC,
};