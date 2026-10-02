/* Conservative calibrated RGBA screencap classifier. No network or input. */
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
typedef struct { int x,y,r,g,b; } Sample;
typedef struct { const char *name; int x,y; const Sample *samples; int count; } Template;
#include "ui-templates.h"
#include "ui-warning-scorpio.h"
#include "ui-templates-scorpio.h"
int main(int argc, char **argv) {
  if (argc != 2) { puts("unknown"); return 0; }
  FILE *f=fopen(argv[1],"rb");
  if (!f) { puts("unknown"); return 0; }
  uint32_t header[4];
  if(fread(header,4,4,f)!=4 || header[2]!=1) {
    fclose(f); puts("unknown"); return 0;
  }
  const Template *profile=NULL; size_t count=0;
  if(header[0]==1440 && header[1]==3120) {
    profile=templates; count=sizeof(templates)/sizeof(templates[0]);
  } else if(header[0]==1220 && header[1]==2712) {
    profile=scorpio_templates; count=sizeof(scorpio_templates)/sizeof(scorpio_templates[0]);
  } else { fclose(f); puts("unknown"); return 0; }
  size_t n=(size_t)header[0]*header[1]*4u;
  unsigned char *p=malloc(n);
  if(!p || fread(p,1,n,f)!=n || fgetc(f)!=EOF) {
    free(p); fclose(f); puts("unknown"); return 0;
  }
  fclose(f);
  const Template *found=NULL;
  for(size_t i=0;i<count;i++) {
    const Template *t=&profile[i]; int good=0;
    for(int j=0;j<t->count;j++) {
      Sample s=t->samples[j]; size_t k=((size_t)s.y*header[0]+s.x)*4;
      if(abs(p[k]-s.r)<=28 && abs(p[k+1]-s.g)<=28 && abs(p[k+2]-s.b)<=28) good++;
    }
    if(good*100>=t->count*96) {
      if(found && strcmp(found->name,t->name)!=0) { free(p); puts("unknown"); return 0; }
      found=t;
    }
  }
  if(found) printf("%s %d %d\n",found->name,found->x,found->y);
  else puts("unknown");
  free(p); return 0;
}
