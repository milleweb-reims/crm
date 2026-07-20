import { Header } from "@/components/header";
import { PipelineBoard } from "@/components/pipeline-board";
import { StatusGuideLink } from "@/components/status-guide";

export default function PipelinePage() {
  return (
    <>
      <Header
        title="Pipeline"
        description="Glissez-déposez les prospects entre les étapes"
        actions={<StatusGuideLink />}
      />
      <PipelineBoard />
    </>
  );
}
