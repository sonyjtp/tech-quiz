import Link from "next/link";
import { notFound } from "next/navigation";
import { loadSubject } from "@/lib/content";
import { requireUser } from "@/lib/auth";
import { aiEnabled, defaultModel } from "@/lib/claude";
import { QuizApp } from "@/components/QuizApp";

export default async function SubjectPage({ params }: { params: Promise<{ subject: string }> }) {
  const slug = (await params).subject;
  await requireUser(`/${slug}`);
  const subject = loadSubject(slug);
  if (!subject) notFound();
  return (
    <>
      <p className="crumbs"><Link href="/">Subjects</Link> / {subject.name}</p>
      <QuizApp subject={{ slug: subject.slug, name: subject.name }} topics={subject.topics} aiEnabled={aiEnabled()} defaultModel={defaultModel()} />
    </>
  );
}
