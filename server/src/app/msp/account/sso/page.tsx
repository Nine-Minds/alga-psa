import ConnectSso from "@/empty/components/settings/account/ConnectSso";

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

export const metadata = {
  title: "Connect Single Sign-On",
};

export default function Page({ searchParams }: PageProps) {
  return <ConnectSso searchParams={searchParams} />;
}
