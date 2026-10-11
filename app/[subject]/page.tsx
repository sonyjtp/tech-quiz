import Link from "next/link";
import { notFound } from "next/navigation";
import { listSubjects, loadSubject } from "@/lib/content";
import { aiEnabled, defaultModel } from "@/lib/claude";
import { QuizApp } from "@/components/QuizApp";

export function generateStaticParams() {
  return listSubjects().map((s) => ({ subject: s.slug }));
}

export default async function SubjectPage({ params }: { params: Promise<{ subject: string }> }) {
  const subject = loadSubject((await params).subject);
  if (!subject) notFound();
  return (
    <>
      <p className="crumbs"><Link href="/">Subjects</Link> / {subject.name}</p>
      <QuizApp subject={{ slug: subject.slug, name: subject.name }} topics={subject.topics} aiEnabled={aiEnabled()} defaultModel={defaultModel()} />
    </>
  );
}
