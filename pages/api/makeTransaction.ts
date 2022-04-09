import { createTransferCheckedInstruction, getAssociatedTokenAddress, getMint, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { clusterApiUrl, Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { NextApiRequest, NextApiResponse } from "next"
import { couponAddress, shopAddress, usdcAddress } from "../../lib/addresses";
import calculatePrice from "../../lib/calculatePrice";
import base58 from 'bs58'

export type MakeTransactionInputData = {
    account: string,
}

type MakeTransactionGetResponse = {
    label: string,
    icon: string,
}

export type MakeTransactionOutputData = {
    transaction:string,
    message: string,
}

type ErrorOutput = {
    error: string
}

function get(res: NextApiResponse<MakeTransactionGetResponse>) {
    res.status(200).json({
        label: "Dope Tracks Inc",
        // Change this icon
        icon: "https://freesvg.org/img/masonmouse_45_Record_Album.png"
    })
}

async function post(
    req: NextApiRequest, 
    res: NextApiResponse<MakeTransactionOutputData | ErrorOutput>
) {
    try {
        // We pass the selected items in the query, calculate the expected cost
        const amount = calculatePrice(req.query)
        if (amount.toNumber() === 0) {
            res.status(400).json({ error: "Can't checkout with charge of 0" })
            return
        }

        // We pass the referenct to use in the query
        const { reference } = req.query
        if (!reference) {
            res.status(400).json({ error: "No reference provided" })
            return
        }

        // We pass the buyer's public key in JSON body
        const { account } = req.body as MakeTransactionInputData
        if (!account) {
            res.status(40).json({ error: "No account provided" })
            return
        }
        
        // We get the shop private key from the .env - this is the same as in our script
        const shopPrivateKey = process.env.SHOP_PRIVATE_KEY as string
        if (!shopPrivateKey) {
            res.status(500).json({ error: "Shop private key not available" })
        }
        const shopKeypair = Keypair.fromSecretKey(base58.decode(shopPrivateKey))
        
        const buyerPublicKey = new PublicKey(account)
        const shopPublicKey = shopAddress

        const network = WalletAdapterNetwork.Devnet
        const endpoint = clusterApiUrl(network)
        const connection = new Connection(endpoint)

        // Get the buyer and seller coupon token accounts
        // Buyer one may not exist, so we creat it (which costs SOL) as the shop account if it doesn't 
        const buyerCouponAccount = await getOrCreateAssociatedTokenAccount(
            connection,
            shopKeypair, // shop pays the fee to create it
            couponAddress, // which token the account is for
            buyerPublicKey, // who the token account belongs to (the buyer)
        )

        const shopCouponAddress = await getAssociatedTokenAddress(couponAddress, shopPublicKey)

        // If the buyer has at least 5 coupons, they can use them and get a discount
        const buyerGetsCouponDiscount = buyerCouponAccount.amount >= 5

        // Get details about the USDC token
        const usdcMint = await getMint(connection, usdcAddress)
        // Get the buyer's USDC token account address
        const buyerUsdcAddress = await getAssociatedTokenAddress(usdcAddress, buyerPublicKey)
        // Get the shop's USDC token account address
        const shopUsdcAddress = await getAssociatedTokenAddress(usdcAddress, shopPublicKey)

        // Get a recent blockhash to include in the transaction
        const { blockhash } = await (connection.getLatestBlockhash('finalized'))

        const transaction = new Transaction({
            recentBlockhash: blockhash,
            // The buyer pays the transaction fee
            feePayer: buyerPublicKey,
        })

        const amountToPay = buyerGetsCouponDiscount ? amount.dividedBy(4).multipliedBy(3) : amount

        // Create the instruction to send USDC from the buyer to the shop
        const transferInstruction = createTransferCheckedInstruction(
            buyerUsdcAddress,
            usdcAddress,
            shopUsdcAddress,
            buyerPublicKey,
            amountToPay.toNumber() * (10 ** usdcMint.decimals),
            usdcMint.decimals,
        )

        // Add the reference to the instruction as a key.
        // This will mean this transaction is returned when we query for the reference
        transferInstruction.keys.push({
            pubkey: new PublicKey(reference),
            isSigner: false,
            isWritable: false,
        })

        // Create the instruction to send the coupon from the shop to the buyer
        const couponInstruction = buyerGetsCouponDiscount ? 
            // The coupon instruction is to send 5 coupons from the buyer to the shop
            createTransferCheckedInstruction(
                buyerCouponAccount.address, // source account (coupon)
                couponAddress, // token address (coupon)
                shopCouponAddress, // destination account (coupon)
                buyerPublicKey, // owner of source account
                5, // amount to transfer
                0, // decimals of the token - we know this is a 0
            ) : 
            // The coupon instruction is to send 1 coupon from the shop to the buyer
            createTransferCheckedInstruction(
                shopCouponAddress, // souce account (coupon)
                couponAddress, // token address (coupon)
                buyerCouponAccount.address, // destination account (coupon)
                shopPublicKey, // owner of source account
                1, // amount to transfer
                0, // decimals of the token 
            )
        
        // Add the shop as a signer to the coupon instruction
        // If the shop is sending the coupon, it already will be a signer
        // But if the buyer is sending the coupons, the show won't be a signer automatically
        // It's usefule security to have the shop sign the transaction
        couponInstruction.keys.push({
            pubkey: shopPublicKey,
            isSigner: true,
            isWritable: false,
        })

        // Add the instruction to the transaction
        transaction.add(transferInstruction, couponInstruction)

        // Sign the transaction as the shop, which is required to transfer the coupon
        // We must partial sign becuase the transfer instriction still requires the user
        transaction.partialSign(shopKeypair)

        // Serialize the transaction and convert to base64 to return it
        const serializedTransaction = transaction.serialize({
            // We will need the buyer to sign this transaction after it's returned to them
            requireAllSignatures: false 
        })
        const base64 = serializedTransaction.toString('base64')

        // Insert into database: reference, amount

        const message = buyerGetsCouponDiscount ? "25% Discount! 🎶" : "Thanks for your order! 🎶"

        // Return the serialized transaction
        res.status(200).json({
            transaction: base64,
            message: message,
        })
    } catch (err) {
        console.error(err);

        res.status(500).json({ error: 'error creating transaction' })
        return
    }
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse<MakeTransactionGetResponse | MakeTransactionOutputData | ErrorOutput>
) {
    if (req.method === "GET") {
        return get(res)
    } else if (req.method === "POST") {
        return await post(req, res)
    } else {
        return res.status(405).json({ error: "Method not allowed" })
    }
}