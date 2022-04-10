import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import CouponBook from '../components/CouponBook'
import Products from '../components/Products'
import SiteHeading from '../components/SiteHeading'

export default function HomePage() {
  // We get the public key of the connected wallet, if there is one.
  const { publicKey } = useWallet() 

  return (
    <div className="flex flex-col gap-8 max-w-4xl items-stretch m-auto pt-24">
      <SiteHeading>Dope Tracks Inc</SiteHeading>

      <div className='basis-1/4'>
        <WalletMultiButton className='!bg-gray-600 hover:scale-105' />
      </div>

      {publicKey && <CouponBook />}

      <Products submitTarget='/checkout' enabled={publicKey !== null} />
    </div>
  )
}
