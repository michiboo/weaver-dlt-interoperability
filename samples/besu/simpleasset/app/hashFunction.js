/*
 * Copyright IBM Corp. All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

const crypto = require("crypto");
const HashMechanism = require("@hyperledger-labs/weaver-protos-js/common/asset_locks_pb")

/*
 * Interface for all hash functions to be used for HTLC
 * To extend supported hash functions in weaver for HTLC,
 * implement following interface, along with adding the same in
 * interopcc. If Hash has more than one element, create a protobuf for it,
 * and serialize the protobuf in base64 in getSerializedHashBase64 function.
 */

class Hash {
    HASH_MECHANISM
    preimage           // Preimage for Hash
    hash64          // Serialized Hash in base64
    generateRandomPreimage(length){}
    setPreimage(preimage){}
    getPreimage(){}
    getSerializedPreimageBase64(){}
    setSerializedHashBase64(hash64){}
    getSerializedHashBase64(){}
}

class SHA extends Hash {
    HASH_MECHANISM
    preimage = null;
    hash64 = null;
    
    computeHash(){}
    
    // Create a secure pseudo-random preimage of a given length
    generateRandomPreimage(length)
    {
        this.setPreimage(crypto.randomBytes(length).toString('base64'));
    }
    
    setPreimage(preimage) {
        this.preimage = preimage
        this.hash64 = this.computeHash()
    }
    getPreimage() {
        return this.preimage;
    }
    getSerializedPreimageBase64() {
        return Buffer.from(this.preimage)
        //.toString('base64')
    }
    
    setSerializedHashBase64(hash64) {
        this.hash64 = hash64;
    }
    getSerializedHashBase64() {
        if(this.hash64 != null)
            return this.hash64
        else
            throw new Error(`Error: Hash or Preimage needs to be set before access`);
    }
}

/*
 * SHA256 Hash for HTLC, implementing above Hash Interface
 */
class SHA256 extends SHA {
    HASH_MECHANISM = HashMechanism.SHA256;
    computeHash() {
        return crypto.createHash('sha256').update(this.preimage).digest('base64');
    }
}
/*
 * SHA512 Hash for HTLC, implementing above Hash Interface
 */
class SHA512 extends SHA {
    HASH_MECHANISM = HashMechanism.SHA512;
    
    computeHash() {
        return crypto.createHash('sha512').update(this.preimage)
        //.digest('base64');
    }
}

module.exports = {
    Hash,
    SHA256,
    SHA512
};
