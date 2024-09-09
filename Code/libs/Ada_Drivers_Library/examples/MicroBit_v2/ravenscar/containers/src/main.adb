with Ada.Containers; use Ada.Containers;
with Ada.Containers.Bounded_Vectors;
with MicroBit.Console; use MicroBit.Console;

--Containers are very useful structures, avoiding the direct use of pointers.
--For embedded targets we like to work with bounded structures, allocating all needed storage in advance.
--See this example: https://learn.adacore.com/courses/intro-to-ada/chapters/standard_library_containers.html
--to make containers work, we need to reserve stack space and create a secondary stack that uses spaces from the top
--In Edit > project properties > Build.Switches.Binder there is a flag -D currently set to 10k meaning 10KB of space.
--Without this flag, the default secondary stack space set in s-parame.ads is 512Bytes.
--The minimum is a value larger than 1K. If the value is too small a Storage Error will be given in the Last Change exception handler.

Procedure Main with Priority => 0 is
          package Integer_Vectors is new
         Ada.Containers.Bounded_Vectors
         (Index_Type   => Natural,
         Element_Type => Integer);

         use Integer_Vectors;

   V : Vector(8);
   C   : Cursor;
begin
   Put_Line ("Appending some elements to the vector...");
   V.Append (3);
   V.Append (4);
   V.Append (5);
   V.Append (7);
   Put_Line ("Finished appending.");

   Put_Line ("Prepending some elements to the vector...");
   V.Prepend (2);
   V.Prepend (1);
   V.Prepend (0);
   Put_Line ("Finished prepending.");

   Put_Line ("Vector has "
             & Count_Type'Image (V.Length)
             & " elements");

   Put_Line ("Adding element with value 6 (before 7)...");

   --
   --  Using V.Insert to insert the element
   --  into the vector
   --
   C := V.Find (7);
   if C /= No_Element then
      V.Insert (C, 6);
   end if;

   Put_Line ("Vector has "
             & Count_Type'Image (V.Length)
             & " elements");

   Put_Line ("Remove element with value 4");

   --  Use Find to retrieve cursor for
   --  the element with value 4
   C := V.Find (4);

   --  Check whether index is valid
   if C /= No_Element then
      --  Remove element using V.Delete
      V.Delete (C);
   end if;

   Put_Line ("Vector has "
             & Count_Type'Image (V.Length)
             & " elements");

   for I in V.First_Index .. V.Last_Index loop
  Put_Line ("Vector " & Integer'Image(I) & " has value " &  Integer'Image (V (I)));
   end loop;


  loop
     null;
  end loop;
end Main;
