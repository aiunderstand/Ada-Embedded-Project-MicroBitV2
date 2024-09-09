with Ada.Text_IO; use Ada.Text_IO;
with Ada.Real_Time; use Ada.Real_Time;
with Display; use Display;

procedure Main is
begin
   loop
      Put_Line ("Serial: Hello Ravenscar!"); -- open a serial port to see this message
      
      Scroll_Text("<"); --what happens if we have a longer text?
      
      delay until Clock + Milliseconds (1000);
   end loop;
end Main;
