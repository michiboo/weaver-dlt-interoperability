// * SPDX-License-Identifier: Apache-2.0
// */

/**
* This file provides helper functions for interoperability operations.
**/
/** End file docs */
import * as assetLocksPb from "@hyperledger-labs/weaver-protos-js/common/asset_locks_pb";
import * as Web3 from 'web3-utils';
import { Hash } from "./HashFunctions";

// Create an asset exchange agreement structure
function createAssetExchangeAgreementSerialized(assetType: string, assetID: string, recipientECert: string, lockerECert: string) {
    const assetExchangeAgreement = new assetLocksPb.AssetExchangeAgreement();
    assetExchangeAgreement.setAssettype(assetType);
    assetExchangeAgreement.setId(assetID);
    assetExchangeAgreement.setRecipient(recipientECert);
    assetExchangeAgreement.setLocker(lockerECert);
    return Buffer.from(assetExchangeAgreement.serializeBinary())
}

function createFungibleAssetExchangeAgreementSerialized(assetType: string, assetID: string, numUnits: number, locker: string, recipient: string) {
    const assetExchangeAgreement = new assetLocksPb.FungibleAssetExchangeAgreement();
    assetExchangeAgreement.setAssettype(assetType);
    assetExchangeAgreement.setNumunits(numUnits);
    assetExchangeAgreement.setRecipient(recipient);
    assetExchangeAgreement.setLocker(locker);
    return Buffer.from(assetExchangeAgreement.serializeBinary())
}


function createHybridAssetExchangeAgreementSerialized(assetType: string, assetID: string, assetData: string, numUnits: number, recipient: string) {
    const assetExchangeAgreement = new assetLocksPb.HybridAssetExchangeAgreement();
    assetExchangeAgreement.setAssettype(assetType);
    assetExchangeAgreement.setId(assetID);
    assetExchangeAgreement.setRecipient(recipient);
    assetExchangeAgreement.setAssetdata(Buffer.from(assetData, "hex"));
    assetExchangeAgreement.setNumunits(numUnits);
    return Buffer.from(assetExchangeAgreement.serializeBinary())
}

// Create an asset lock structure
function createAssetLockInfoSerialized(hash: Hash, expiryTimeSecs: number) {
    const lockInfoHTLC = new assetLocksPb.AssetLockHTLC();
    lockInfoHTLC.setHashmechanism(hash.HASH_MECHANISM);
    lockInfoHTLC.setHashbase64(Buffer.from(hash.getSerializedHashBase64()));
    lockInfoHTLC.setExpirytimesecs(expiryTimeSecs);
    lockInfoHTLC.setTimespec(assetLocksPb.TimeSpec.EPOCH)
    return Buffer.from(lockInfoHTLC.serializeBinary())
}

// Create an asset claim structure
function createAssetClaimInfoSerialized(hash: Hash) {
    const claimInfoHTLC = new assetLocksPb.AssetClaimHTLC();
    claimInfoHTLC.setHashmechanism(hash.HASH_MECHANISM);
    claimInfoHTLC.setHashpreimagebase64(Buffer.from(hash.getSerializedHashBase64()));
    const claimInfoHTLCSerialized = claimInfoHTLC.serializeBinary();
    const claimInfo = new assetLocksPb.AssetClaim();
    claimInfo.setLockmechanism(assetLocksPb.LockMechanism.HTLC);
    claimInfo.setClaiminfo(claimInfoHTLCSerialized);
    return Buffer.from(claimInfo.serializeBinary())
}

const createHTLC = async (
    assetManagerContract: any,
    tokenContract: any,
    assetType: string,
    assetID: string,
    assetData: string,
    assetAmount: number,
    senderAddress: string,
    recipientAddress: string,
    expiryTimeSecs: number,
    hash: Hash
): Promise<{ result: any }> => {

    if (!assetManagerContract) {
        console.log("Contract handle not supplied");
        return { result: false };
    }
    if (!recipientAddress) {
        console.log(`Recipient address not supplied ${recipientAddress}`);
        return { result: false };
    }
    const currTimeSecs = Math.floor(Date.now() / 1000);   // Convert epoch milliseconds to seconds
    if (expiryTimeSecs <= currTimeSecs) {
        console.log("Supplied expiry time invalid or in the past: %s; current time: %s", new Date(expiryTimeSecs).toISOString(), new Date(currTimeSecs).toISOString());
        return { result: false };
    }
    var protobufParams;
    if (assetType == "ERC721") {
        protobufParams = createAssetExchangeAgreementSerialized("", String(assetID), recipientAddress.slice(2), Web3.utf8ToHex((assetData)));
    } else if (assetType == "ERC20") {
        protobufParams = createFungibleAssetExchangeAgreementSerialized("", String(assetID), assetAmount, "", recipientAddress.slice(2));
    } else if (assetType == "ERC1155") {
        protobufParams = createHybridAssetExchangeAgreementSerialized("", String(assetID), Web3.utf8ToHex(String(assetData)), assetAmount, recipientAddress.slice(2));
    }
    if (!protobufParams) {
        console.log("Error creating protobuf params");
        return { result: false };
    }
    const lockInfoParams = createAssetLockInfoSerialized(hash, expiryTimeSecs);
    // Normal invoke function
    var lockStatus;
    if (assetType == "ERC1155") {
        var lockStatus = await assetManagerContract.lockAsset(
            tokenContract.address,
            protobufParams,
            lockInfoParams,
            {
                from: senderAddress,
            }
        ).catch(function (e: any) {
            console.log(e);
            console.log("lockAsset threw an error");
            lockStatus = { result: false }
        })
    }
    else if (assetType == "ERC721") {
        var lockStatus = await assetManagerContract.lockNonFungibleAsset(
            tokenContract.address,
            protobufParams,
            lockInfoParams,
            {
                from: senderAddress,
            }
        ).catch(function (e: any) {
            console.log(e);
            console.log("lockAsset threw an error");
            lockStatus = { result: false }
        })
    } else if (assetType == "ERC20") {
        var lockStatus = await assetManagerContract.lockFungibleAsset(
            tokenContract.address,
            protobufParams,
            lockInfoParams,
            {
                from: senderAddress,
            }
        ).catch(function (e: any) {
            console.log(e);
            console.log("lockAsset threw an error");
            lockStatus = { result: false }
        })
    }
    return { result: lockStatus };
};

/**
 * Latter step of a Hashed Time Lock Contract
 * - Claim a unique asset instance using a hash preimage
 **/
const claimAssetInHTLC = async (
    lockContractId: string,
    assetManagerContract: any,
    senderAddress: string,
    hash: Hash,
): Promise<any> => {

    if (!assetManagerContract) {
        console.log("Contract Address not supplied");
        return false;
    }

    // const hash = new SHA256()
    // hash.setPreimage(preimage)
    const claimInfoStr = createAssetClaimInfoSerialized(hash);
    // Normal invoke function
    var claimStatus = await assetManagerContract.claimAsset(lockContractId, claimInfoStr, { from: senderAddress }).catch(function (e: any) {
        console.log(e)
        console.log("claimAsset threw an error");
        claimStatus = false
    })

    return claimStatus;
};

const isAssetLockedInHTLC = async (
    assetManagerContract: any,
    lockContractId: string,
): Promise<any> => {

    if (!assetManagerContract) {
        console.log("Contract not supplied");
        return false;
    }

    // Normal invoke function
    var lockStatus = await assetManagerContract.isAssetLocked(lockContractId).catch(function (e: any) {
        console.log(e)
        console.log("isAssetLock threw an error");
        lockStatus = false
    })

    return lockStatus;
};


const reclaimAssetInHTLC = async (
    interopContract: any,
    lockContractId: string,
    sender: string,
): Promise<void> => {
    var unlockStatus = await interopContract.unlockAsset(lockContractId, {
        from: sender
    }).catch(function (e: any) {
        console.log(e)
        console.log("unlockAsset threw an error");
        unlockStatus = false
    })

    return unlockStatus
}

export {
    createAssetExchangeAgreementSerialized,
    createAssetClaimInfoSerialized,
    createHTLC,
    claimAssetInHTLC,
    reclaimAssetInHTLC,
    isAssetLockedInHTLC
};