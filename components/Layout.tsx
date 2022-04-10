import { PropsWithChildren } from "react";
import Footer from "./Footer";

export default function Layout({ children }: PropsWithChildren<{}>) {
  return (
    <div className='bg-gray-900 min-h-screen flex flex-col gap-16'>
      <main className='mb-auto pt-24'>
        {children}
      </main>
      <Footer />
    </div>
  )
}
