// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.8;

import "./transferInterface.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "./asset_locks.proto.sol";

/**
 * Hashed Timelock Contract on Assets in an Ethereum network (Support only for ERC20, ERC721 and ERC1155 tokens)
 **/

contract AssetExchangeContract is ERC1155Holder {
    mapping(bytes32 => LockContract) public lockContracts;

    struct LockContract {
        address sender;
        address receiver;
        address assetContract;
        uint256 amount;
        bytes32 hashLock;
        uint256 expirationTime;
        uint8 status;
        uint256 tokenId;
        bytes data;
    }

    struct transferInfo {
        address sender;
        address receiver;
        uint256 amount;
    }

    uint8 constant UNUSED = 0;
    uint8 constant LOCKED = 1;

    event Lock(
        address indexed sender,
        address indexed receiver,
        address assetContract,
        uint256 amount,
        bytes32 hashLock,
        uint256 expirationTime,
        bytes32 lockContractId
    );

    event Claim(
        address indexed sender,
        address indexed receiver,
        bytes32 indexed lockContractId,
        bytes32 hashLock,
        bytes32 preimage
    );

    event Unlock(
        address indexed sender,
        address indexed receiver,
        bytes32 indexed lockContractId
    );
    
    function bytesToAddress(bytes memory bys) public pure returns (address addr) {
        assembly {
             addr := mload(add(bys,20))
       }
    }

    function bytesTobytes32(bytes memory bys) public pure returns (bytes32 res) {
        assembly {
             res := mload(add(bys,32))
       }
    }

    function lockAsset(bytes memory rawParams, address assetContract,
        uint256 amount,
        bytes32 hashLock,
        uint256 expirationTime,
        bytes memory data) external
		returns (bytes32 lockContractId){
		bytes memory rawParamsBytes = rawParams;
			AssetExchangeAgreement memory params;
				(, , params) = AssetExchangeAgreementCodec.decode(0, rawParamsBytes, uint64(rawParamsBytes.length));
		address sender = msg.sender;
        uint256 tokenId = abi.decode(abi.encode(params.id), (uint256));
		// Checking the validity of the input parameters
        require(amount > 0, "Amount should be greater than zero");
        transferStruct.Info memory transInfo = transferStruct.Info({
            sender: sender,
            receiver: address(this),
            amount: amount,
            tokenId: tokenId,
            data: data
        });
        require(
            transferInterface(assetContract).allowanceInterop(transInfo) ==
                true,
            "Allowance of assets from the sender for the lock contract must be greater than the amount to be locked"
        );
        require(
            expirationTime > block.timestamp,
            "Expiration time should be in the future"
        );
        address receiver = bytesToAddress(fromHex(params.recipient));
		// The identity of the lock contract is a hash of all the relevant parameters that will uniquely identify the contract
	    lockContractId = sha256(
            abi.encodePacked(
                sender,
                receiver,
                assetContract,
                amount,
                hashLock,
                expirationTime
            )
        );


		require(
            lockContracts[lockContractId].status == UNUSED,
            "An active lock contract already exists with the same parameters"
        );

        // Locking amount by transfering them to the lockContract

        bool transferStatus = transferInterface(assetContract).transferInterop(
            transInfo
        );
        // bool transferStatus = ERC20(assetContract).transferFrom(sender, address(this), amount);
        require(
            transferStatus == true,
            "ERC20 transferFrom failed from the sender to the lockContract"
        );

	 lockContracts[lockContractId] = LockContract(
            sender,
            receiver,
            assetContract,
            amount,
            hashLock,
            expirationTime,
            LOCKED,
            tokenId,
            data
        );

        emit Lock(
            sender,
            receiver,
            assetContract,
            amount,
            hashLock,
            expirationTime,
            lockContractId
        );
	}

    // The receiver claims the ownership of an asset locked for them once they obtain the preimage of the hashlock
    function claimAsset(bytes32 lockContractId, bytes memory lockInfoProtobuf)
        external
        returns (bool)
    {
        LockContract storage c = lockContracts[lockContractId];
        AssetClaimHTLC memory params;
				(, , params) = AssetClaimHTLCCodec.decode(0, lockInfoProtobuf, uint64(lockInfoProtobuf.length));
        bytes32 preimage = bytesTobytes32(slice(params.hashPreimageBase64,2,32));
        // Check the validity of the claim
        require(c.status == LOCKED, "lockContract is not active");
        require(block.timestamp < c.expirationTime, "lockContract has expired");
        bytes32 encryptedPreimage;
        if(params.hashMechanism == HashMechanism.SHA256){
            encryptedPreimage = sha256(abi.encodePacked(preimage));
        }
        require(
            c.hashLock == encryptedPreimage,
            "Invalid preimage, its hash does not equal the hashLock"
        );
        transferStruct.Info memory transInfo = transferStruct.Info({
            sender: address(this),
            receiver: c.receiver,
            amount: c.amount,
            tokenId: c.tokenId,
            data: c.data
        });

        c.assetContract.call(
            abi.encodeWithSignature(
                "approve(address,uint256)",
                c.assetContract,
                c.amount
            )
        );
        c.assetContract.call(
            abi.encodeWithSignature(
                "setApprovalForAll(address,bool)",
                c.assetContract,
                true
            )
        );

        bool transferStatus = transferInterface(c.assetContract)
            .transferInterop(transInfo);
        require(
            transferStatus == true,
            "ERC20 transfer failed from the lockContract to the receiver"
        );

        emit Claim(c.sender, c.receiver, lockContractId, c.hashLock, preimage);

        return true;
    }

    // Unlocking and reclaiming a locked asset for the sender after the expiration time. Can be called by anyone, not just the sender.
    function unlockAsset(bytes32 lockContractId) external returns (bool) {
        LockContract storage c = lockContracts[lockContractId];

        // Validation checks
        require(
            c.status == LOCKED,
            "There is no active lockContract with the specified ID"
        );
        require(c.sender != address(0), "Sender address is invalid");
        require(
            block.timestamp >= c.expirationTime,
            "Lock contract has expired"
        );
        transferStruct.Info memory transInfo = transferStruct.Info({
            sender: address(this),
            receiver: c.sender,
            amount: c.amount,
            tokenId: c.tokenId,
            data: c.data
        });
        c.assetContract.call(
            abi.encodeWithSignature(
                "approve(address,uint256)",
                c.assetContract,
                c.amount
            )
        );
        c.assetContract.call(
            abi.encodeWithSignature(
                "setApprovalForAll(address,bool)",
                c.assetContract,
                true
            )
        );
        bool transferStatus = transferInterface(c.assetContract)
            .transferInterop(transInfo);
        require(
            transferStatus == true,
            "ERC20 transfer failed from the lockContract back to the sender"
        );

        emit Unlock(c.sender, c.receiver, lockContractId);

        return true;
    }

    // Function to check if there is an active contract with the input lockContractId.
    function isAssetLocked(bytes32 lockContractId)
        external
        view
        returns (bool)
    {
        LockContract storage c = lockContracts[lockContractId];

        bool lockContractStatus;
        if (c.status == LOCKED) {
            lockContractStatus = true;
        } else {
            lockContractStatus = false;
        }

        return lockContractStatus;
    }

    function fromHexChar(uint8 c) public pure returns (uint8) {
        if (bytes1(c) >= bytes1("0") && bytes1(c) <= bytes1("9")) {
            return c - uint8(bytes1("0"));
        }
        if (bytes1(c) >= bytes1("a") && bytes1(c) <= bytes1("f")) {
            return 10 + c - uint8(bytes1("a"));
        }
        if (bytes1(c) >= bytes1("A") && bytes1(c) <= bytes1("F")) {
            return 10 + c - uint8(bytes1("A"));
        }
        revert("fail");
    }

    // Convert an hexadecimal string to raw bytes
    function fromHex(string memory s) public pure returns (bytes memory) {
        bytes memory ss = bytes(s);
        require(ss.length % 2 == 0); // length must be even
        bytes memory r = new bytes(ss.length / 2);
        for (uint256 i = 0; i < ss.length / 2; ++i) {
            r[i] = bytes1(
                fromHexChar(uint8(ss[2 * i])) *
                    16 +
                    fromHexChar(uint8(ss[2 * i + 1]))
            );
        }
        return r;
    }
    
    function slice(
        bytes memory _bytes,
        uint256 _start,
        uint256 _length
    )
        internal
        pure
        returns (bytes memory)
    {
        require(_length + 31 >= _length, "slice_overflow");
        require(_bytes.length >= _start + _length, "slice_outOfBounds");

        bytes memory tempBytes;

        assembly {
            switch iszero(_length)
            case 0 {
                // Get a location of some free memory and store it in tempBytes as
                // Solidity does for memory variables.
                tempBytes := mload(0x40)

                // The first word of the slice result is potentially a partial
                // word read from the original array. To read it, we calculate
                // the length of that partial word and start copying that many
                // bytes into the array. The first word we copy will start with
                // data we don't care about, but the last `lengthmod` bytes will
                // land at the beginning of the contents of the new array. When
                // we're done copying, we overwrite the full first word with
                // the actual length of the slice.
                let lengthmod := and(_length, 31)

                // The multiplication in the next line is necessary
                // because when slicing multiples of 32 bytes (lengthmod == 0)
                // the following copy loop was copying the origin's length
                // and then ending prematurely not copying everything it should.
                let mc := add(add(tempBytes, lengthmod), mul(0x20, iszero(lengthmod)))
                let end := add(mc, _length)

                for {
                    // The multiplication in the next line has the same exact purpose
                    // as the one above.
                    let cc := add(add(add(_bytes, lengthmod), mul(0x20, iszero(lengthmod))), _start)
                } lt(mc, end) {
                    mc := add(mc, 0x20)
                    cc := add(cc, 0x20)
                } {
                    mstore(mc, mload(cc))
                }

                mstore(tempBytes, _length)

                //update free-memory pointer
                //allocating the array padded to 32 bytes like the compiler does now
                mstore(0x40, and(add(mc, 31), not(31)))
            }
            //if we want a zero-length slice let's just return a zero-length array
            default {
                tempBytes := mload(0x40)
                //zero out the 32 bytes slice we are about to return
                //we need to do it because Solidity does not garbage collect
                mstore(tempBytes, 0)

                mstore(0x40, add(tempBytes, 0x20))
            }
        }

        return tempBytes;
    }
}
